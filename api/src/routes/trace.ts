import { query } from '../db/pool.js';
import { verifyChain, type EventRow } from '../services/chain.js';
import { DEFAULT_CORRIDOR, evaluateGate, type StageRequirementRow } from '../services/gates.js';
import { requirementsForCorridor } from '../services/gateFacts.js';
import { headOf } from '../services/anchorJob.js';
import { toDetachedOtsFile } from '../services/ots.js';
import { STAGES } from '@atims/shared';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/**
 * Public trace (no account needed: buyers scan the QR on the label).
 *
 * GET /trace/:trace_id is a derived, read-only view. It exposes no private data:
 * no entity UUIDs, names or Nexus IDs, no batch UUID, no storage object keys and
 * no free-text notes or document metadata. Parties appear as role plus trust tier.
 *
 * The page does not take this view on trust: it also fetches the raw signed chain
 * from GET /verify/:id, verifies it in the browser (shared/src/verify.ts) and checks
 * every item shown here against the verified events by seq and payload_hash.
 * The raw chain necessarily carries the exact bytes that were hashed and signed,
 * including actor ids; that is the price of independent verification.
 */

// ── Pure view builder (unit-tested in api/test/trace.test.ts) ──

export interface TraceEventInput {
  seq: number; event_type: string; to_stage: string | null; created_at: string | Date;
  payload: unknown; payload_hash: string; actor_sig: string | null;
  actor_role: string; actor_trust_tier: string | null;
}

export interface TraceEvidenceInput {
  seq: number; evidence_type: string; file_hash: string; created_at: string | Date;
  issuer_role: string; issuer_trust_tier: string | null; meta: unknown;
}

export interface TraceAnchorInput {
  head_hash: string; ots_proof: string | null; block_height: number | null;
  submitted_at: string | Date; confirmed_at: string | Date | null;
}

const iso = (v: string | Date | null | undefined) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

function analytesOf(meta: unknown): string[] {
  const a = (meta as { analytes?: unknown } | null)?.analytes;
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toUpperCase()) : [];
}

/** The public summary of an event's payload: only fields that are safe to publish. */
function publicDetail(e: TraceEventInput): Record<string, unknown> {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.event_type) {
    case 'EVIDENCE_ADDED':
      return { evidence_type: p.evidence_type, file_hash: p.file_hash, issued_by_role: p.issued_by_role };
    case 'INSPECTION_SIGNOFF':
      return { decision: p.decision };
    case 'GATE_REJECTED': {
      const gate = (p.gate ?? {}) as { missing_evidence?: unknown; invalid_issuer?: unknown; missing_events?: unknown };
      return { missing_evidence: gate.missing_evidence ?? [], invalid_issuer: gate.invalid_issuer ?? [], missing_events: gate.missing_events ?? [] };
    }
    default:
      return {};
  }
}

export function buildTraceView(input: {
  batch: Record<string, unknown>;
  corridor: Record<string, unknown> | null;
  requirements: StageRequirementRow[];
  events: TraceEventInput[];
  evidence: TraceEvidenceInput[];
  anchors: TraceAnchorInput[];
  head_hash: string | null;
}) {
  const { batch, corridor, requirements, events, evidence, anchors, head_hash } = input;
  const reqFor = new Map(requirements.map((r) => [r.to_stage, r]));

  // ── Route: every stage of the corridor, when it was reached and which gate items it met
  const route = STAGES.map((stage, idx) => {
    const reachedBy = idx === 0
      ? events.find((e) => e.event_type === 'BATCH_CREATED')
      : events.find((e) => e.event_type === 'STAGE_ADVANCE' && e.to_stage === stage);
    const req = idx === 0 ? null : reqFor.get(stage) ?? null;
    let gate: null | {
      passed: boolean;
      items: Array<{
        kind: string; type: string; supplied_by: string[]; analytes?: string[]; satisfied: boolean;
        satisfied_by?: { seq: number; issuer_role: string; issuer_trust_tier: string | null; file_hash?: string };
      }>;
    } = null;
    if (idx > 0) {
      // Facts as they stood just before the advance (or now, for stages not reached yet).
      const cutoff = reachedBy ? reachedBy.seq : Number.POSITIVE_INFINITY;
      const evBefore = evidence.filter((e) => e.seq < cutoff);
      const eventsBefore = events.filter((e) => e.seq < cutoff);
      const result = evaluateGate({
        to_stage: stage,
        evidence_present: evBefore.map((e) => ({ evidence_type: e.evidence_type, issued_by_role: e.issuer_role, meta: e.meta })),
        // Required events are matched by role here: the public view has no entity ids.
        // A 'batch_buyer' rule is met by a DELIVERY_CONFIRMED that the server accepted,
        // and only the named buyer can submit one (access.ts confirm_delivery).
        events_present: eventsBefore.map((e) => ({ event_type: e.event_type, actor_id: e.actor_role === 'buyer' ? 'batch_buyer' : e.actor_role, actor_role: e.actor_role })),
        buyer_id: 'batch_buyer',
      }, req);
      gate = {
        passed: Boolean(reachedBy) || result.pass,
        items: result.checklist.map((it) => {
          const out: NonNullable<typeof gate>['items'][number] = {
            kind: it.kind, type: it.type, supplied_by: it.supplied_by, satisfied: it.satisfied,
            ...(it.analytes ? { analytes: it.analytes } : {}),
          };
          if (it.satisfied && it.kind === 'evidence') {
            const by = evBefore.find((e) => e.evidence_type === it.type
              && (it.supplied_by.length === 0 || it.supplied_by.includes(e.issuer_role))
              && (it.analytes ?? []).every((a) => analytesOf(e.meta).includes(a)));
            if (by) out.satisfied_by = { seq: by.seq, issuer_role: by.issuer_role, issuer_trust_tier: by.issuer_trust_tier, file_hash: by.file_hash };
          } else if (it.satisfied && it.kind === 'event') {
            const by = eventsBefore.find((e) => e.event_type === it.type);
            if (by) out.satisfied_by = { seq: by.seq, issuer_role: by.actor_role, issuer_trust_tier: by.actor_trust_tier };
          }
          return out;
        }),
      };
    }
    return {
      stage,
      description: req?.description ?? null,
      reached: Boolean(reachedBy),
      reached_at: iso(reachedBy?.created_at),
      reached_seq: reachedBy?.seq ?? null,
      gate,
    };
  });

  // ── Custody: origin, then each CUSTODY_TRANSFER (the receiver signs it)
  const custody: Array<{ seq: number; at: string | null; from_role: string | null; to_role: string; to_trust_tier: string | null }> = [];
  let holder: TraceEventInput | undefined = events.find((e) => e.event_type === 'BATCH_CREATED');
  if (holder) custody.push({ seq: holder.seq, at: iso(holder.created_at), from_role: null, to_role: holder.actor_role, to_trust_tier: holder.actor_trust_tier });
  for (const e of events) {
    if (e.event_type !== 'CUSTODY_TRANSFER') continue;
    custody.push({ seq: e.seq, at: iso(e.created_at), from_role: holder?.actor_role ?? null, to_role: e.actor_role, to_trust_tier: e.actor_trust_tier });
    holder = e;
  }

  const sorted = anchors.length
    ? [...anchors].sort((a, b) => new Date(b.submitted_at).valueOf() - new Date(a.submitted_at).valueOf())
    : [];

  return {
    batch: {
      trace_id: batch.trace_id, commodity: batch.commodity, variety: batch.variety ?? null,
      quantity: batch.quantity, unit: batch.unit, production_date: batch.production_date,
      origin_state: batch.origin_state ?? null, destination_country: batch.destination_country ?? null,
      current_stage: batch.current_stage, compliance_status: batch.compliance_status ?? null,
      created_at: iso(batch.created_at as string | Date | null),
    },
    corridor: corridor ? {
      code: corridor.code, name: corridor.name, origin_country: corridor.origin_country ?? null,
      destination_country: corridor.destination_country ?? null, commodity: corridor.commodity ?? null,
      description: corridor.description ?? '',
    } : null,
    route,
    history: events.map((e) => ({
      seq: e.seq, event_type: e.event_type, to_stage: e.to_stage, created_at: iso(e.created_at),
      payload_hash: e.payload_hash, signed: Boolean(e.actor_sig),
      actor_role: e.actor_role, actor_trust_tier: e.actor_trust_tier,
      detail: publicDetail(e),
    })),
    evidence: evidence.map((e) => ({
      seq: e.seq, evidence_type: e.evidence_type, file_hash: e.file_hash, created_at: iso(e.created_at),
      issuer_role: e.issuer_role, issuer_trust_tier: e.issuer_trust_tier,
      ...(analytesOf(e.meta).length ? { analytes: analytesOf(e.meta) } : {}),
    })),
    custody,
    head_hash,
    anchors: sorted.map((a) => {
      let ots_file: string | null = null;
      try {
        if (a.ots_proof) ots_file = Buffer.from(toDetachedOtsFile(a.head_hash, Buffer.from(a.ots_proof, 'base64'))).toString('base64');
      } catch { ots_file = null; }
      return {
        head_hash: a.head_hash,
        confirmed: Boolean(a.confirmed_at),
        block_height: a.block_height,
        submitted_at: iso(a.submitted_at),
        confirmed_at: iso(a.confirmed_at),
        is_current_head: head_hash !== null && a.head_hash === head_hash,
        // Detached .ots for the OpenTimestamps client: ots verify -d <head_hash> <file>
        ots_file,
      };
    }),
  };
}

// ── Routes ─────────────────────────────────────────────────

export default async function traceRoutes(app: FastifyInstance) {
  app.get<{ Params: { trace_id: string } }>(
    '/trace/:trace_id',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req: FastifyRequest<{ Params: { trace_id: string } }>, reply: FastifyReply) => {
      const batch = (await query<Record<string, unknown>>(
        `SELECT id, trace_id, commodity, variety, quantity, unit, production_date, origin_state,
                current_stage, compliance_status, destination_country, corridor, created_at
           FROM batches WHERE trace_id = $1`,
        [String(req.params.trace_id).toUpperCase()],
      )).rows[0];
      if (!batch) return reply.code(404).send({ error: 'batch not found' });
      const corridorCode = String(batch.corridor ?? DEFAULT_CORRIDOR);

      const [rawEvents, evidence, anchors, corridor, requirements] = await Promise.all([
        query<EventRow & { actor_role: string; actor_trust_tier: string | null }>(
          `SELECT be.batch_id, be.seq, be.event_type, be.actor_id, be.actor_pubkey, be.actor_sig,
                  be.prev_hash, be.payload_hash, be.to_stage, be.payload, be.created_at,
                  e.role AS actor_role, e.trust_tier AS actor_trust_tier
             FROM batch_events be JOIN entities e ON e.id = be.actor_id
            WHERE be.batch_id = $1 ORDER BY be.seq ASC`, [batch.id],
        ).then((r) => r.rows),
        query<TraceEvidenceInput>(
          `SELECT be.seq, ev.evidence_type, ev.file_hash, ev.created_at, ent.role AS issuer_role,
                  ent.trust_tier AS issuer_trust_tier, ev.meta
             FROM evidence ev
             JOIN batch_events be ON be.id = ev.event_id
             JOIN entities ent ON ent.id = ev.actor_id
            WHERE ev.batch_id = $1 ORDER BY be.seq ASC`, [batch.id],
        ).then((r) => r.rows),
        query<TraceAnchorInput>(
          `SELECT head_hash, ots_proof, block_height, submitted_at, confirmed_at
             FROM chain_anchors WHERE batch_id = $1 ORDER BY submitted_at DESC`, [batch.id],
        ).then((r) => r.rows),
        query(`SELECT code, name, origin_country, destination_country, commodity, description FROM corridors WHERE code = $1`, [corridorCode])
          .then((r) => r.rows[0] ?? null),
        requirementsForCorridor(corridorCode),
      ]);

      const last = rawEvents[rawEvents.length - 1];
      const view = buildTraceView({
        batch, corridor, requirements, evidence, anchors,
        events: rawEvents.map((e) => ({
          seq: e.seq, event_type: e.event_type, to_stage: e.to_stage, created_at: e.created_at,
          payload: e.payload, payload_hash: e.payload_hash, actor_sig: e.actor_sig,
          actor_role: e.actor_role, actor_trust_tier: e.actor_trust_tier,
        })),
        head_hash: last ? headOf({ ...last, batch_id: String(last.batch_id) }) : null,
      });
      // The server's own check, for reference. The trace page shows its own browser result.
      const integrity = verifyChain(rawEvents);
      reply.send({ ...view, server_integrity: { valid: integrity.valid, problems: integrity.problems } });
    },
  );

  /** GET /verify/:id (batch id or trace id): the RAW event chain. Verification is done
   *  by the caller (trace page, /verify page, atims-verify CLI) so nobody must trust this server. */
  app.get<{ Params: { batch_id: string } }>(
    '/verify/:batch_id',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const rows = (await query<{ id: string; trace_id: string }>(
        `SELECT id, trace_id FROM batches WHERE id::text = $1 OR trace_id = upper($1)`, [req.params.batch_id],
      )).rows[0];
      if (!rows) return reply.code(404).send({ error: 'not found' });
      const events = (await query(
        `SELECT batch_id, seq, event_type, actor_id, actor_pubkey, actor_sig, prev_hash,
                payload_hash, to_stage, payload, created_at
         FROM batch_events WHERE batch_id = $1 ORDER BY seq ASC`, [rows.id],
      )).rows.map((e: Record<string, unknown>) => ({
        ...e,
        // ISO string so third-party verifiers hash the exact insert-time value.
        created_at: e.created_at instanceof Date ? (e.created_at as Date).toISOString() : String(e.created_at),
      }));
      reply.send({ trace_id: rows.trace_id, events });
    },
  );
}

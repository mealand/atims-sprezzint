import { query, actor } from '../db/pool.js';
import { evaluateGate, type StageRequirementRow } from '../services/gates.js';
import { canonicalHash, canonicalize, STAGES, type Stage, type Role } from '@atims/shared';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface CreateBody {
  commodity?: string; variety?: string; quantity?: number; unit?: string;
  production_date?: string; origin_state?: string; destination_country?: string; notes?: string;
}
interface EventBody {
  event_type?: string; to_stage?: string; payload?: Record<string, unknown>;
  actor_pubkey?: string; actor_sig?: string; dry_run?: boolean; created_at?: string;
}

/** sha256 over the documented prev-hash format — MUST stay in sync with services/chain.ts. */
function sha256Prev(prior: Record<string, unknown>): string {
  return createHash('sha256')
    .update(canonicalize({
      batch_id: prior.batch_id, seq: prior.seq, payload_hash: prior.payload_hash,
      actor_pubkey: prior.actor_pubkey, actor_sig: prior.actor_sig,
    }))
    .digest('hex');
}

export default async function batchRoutes(app: FastifyInstance) {
  /** POST /batches — farmers create a batch; genesis event recorded (server-attested). */
  app.post<{ Body: CreateBody }>(
    '/batches',
    { onRequest: [app.authenticate, app.requireRole('farmer')] },
    async (req: FastifyRequest<{ Body: CreateBody }>, reply) => {
      const { commodity, variety, quantity, unit, production_date, origin_state, destination_country, notes } = req.body ?? {};
      if (!commodity || !quantity || !unit || !production_date) {
        return reply.code(400).send({ error: 'commodity, quantity, unit, production_date required' });
      }

      const traceId = `CROP-${new Date().getFullYear()}-${canonicalHash({ commodity, quantity, production_date, actor: actor(req), r: Math.random() }).slice(0, 8).toUpperCase()}`;

      const { rows } = await query<Record<string, unknown>>(
        `INSERT INTO batches (trace_id, origin_entity_id, commodity, variety, quantity, unit, production_date,
            origin_state, current_stage, current_holder_id, destination_country, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'HARVESTED',$2,$9,$10)
         RETURNING *`,
        [traceId, actor(req), commodity, variety ?? null, quantity, unit, production_date, origin_state ?? null, destination_country ?? null, notes ?? null],
      );
      const batch = rows[0];

      const payload = { created: { commodity, quantity, unit, production_date } };
      const payloadHash = canonicalHash(payload);
      const { rows: evRows } = await query(
        `INSERT INTO batch_events (batch_id, seq, event_type, actor_id, payload_hash, to_stage, payload)
         VALUES ($1, 0, 'BATCH_CREATED', $2, $3, 'HARVESTED', $4) RETURNING id, created_at`,
        [batch.id, actor(req), payloadHash, payload],
      );
      reply.code(201).send({ batch, genesis_event: evRows[0] });
    },
  );

  /** GET /batches (mine) */
  app.get('/batches', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { rows } = await query(
      `SELECT * FROM batches WHERE origin_entity_id = $1 OR current_holder_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [actor(req)],
    );
    reply.send({ batches: rows });
  });

  /** GET /batches/:id — batch + events + evidence for actors & inspectors */
  app.get<{ Params: { id: string } }>('/batches/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { rows } = await query<Record<string, unknown>>(
      `SELECT * FROM batches WHERE id::text = $1 OR trace_id = $1`, [req.params.id],
    );
    const batch = rows[0];
    if (!batch) return reply.code(404).send({ error: 'batch not found' });
    const events = (await query(`SELECT * FROM batch_events WHERE batch_id = $1 ORDER BY seq ASC`, [batch.id])).rows;
    const evidence = (await query(
      `SELECT e.*, ent.role AS issued_by_role FROM evidence e JOIN entities ent ON ent.id = e.actor_id
       WHERE e.batch_id = $1 ORDER BY e.created_at`, [batch.id],
    )).rows;
    reply.send({ batch, events, evidence });
  });

  /**
   * POST /batches/:id/events — the core write path.
   * Only the current holder appends. Stage advance is gate-enforced (422 with gate report on failure).
   */
  app.post<{ Params: { id: string }; Body: EventBody }>(
    '/batches/:id/events',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest<{ Params: { id: string }; Body: EventBody }>, reply) => {
      const batchRow = (await query<Record<string, unknown>>(
        `SELECT * FROM batches WHERE id::text = $1`, [req.params.id],
      )).rows[0];
      if (!batchRow) return reply.code(404).send({ error: 'batch not found' });
      if (batchRow.compliance_status === 'blocked') return reply.code(409).send({ error: 'batch is blocked by a failed gate' });

      const { event_type, to_stage, payload, actor_pubkey, actor_sig, dry_run, created_at } =
        req.body as EventBody & { dry_run?: boolean; created_at?: string };
      if (!event_type || !payload) return reply.code(400).send({ error: 'event_type and payload required' });

      if (batchRow.current_holder_id !== actor(req)) {
        return reply.code(403).send({ error: 'only the current holder can append events' });
      }

      const batchId = String(batchRow.id);

      // ── Stage gate enforcement ──
      if (to_stage && to_stage !== batchRow.current_stage && STAGES.includes(to_stage as Stage)) {
        const gateReq = ((await query<StageRequirementRow>(
          `SELECT * FROM stage_requirements WHERE to_stage = $1`, [to_stage],
        )).rows[0] ?? null) as StageRequirementRow | null;
        const evidence = ((await query<{ evidence_type: string; issued_by_role: string | null }>(
          `SELECT e.evidence_type, ent.role AS issued_by_role FROM evidence e
           JOIN entities ent ON ent.id = e.actor_id WHERE e.batch_id = $1`, [batchId],
        )).rows) as Array<{ evidence_type: string; issued_by_role: Role | null }>;
        const gate = evaluateGate({ to_stage: to_stage as Stage, evidence_present: evidence }, gateReq);
        if (!gate.pass) {
          await query(
            `INSERT INTO batch_events (batch_id, seq, event_type, actor_id, payload_hash, to_stage, payload)
             SELECT $1, COALESCE(MAX(seq),-1)+1, 'GATE_REJECTED', $2, $3, $4, $5::jsonb FROM batch_events WHERE batch_id = $1`,
            [batchId, actor(req), canonicalHash({ rejected_stage: to_stage, gate }), to_stage, JSON.stringify({ gate })],
          );
          return reply.code(422).send({ error: 'gate failed', gate });
        }
      }

      // ── Append the event on the hash chain ──
      const seq = Number(((await query<{ s: number }>(
        `SELECT COALESCE(MAX(seq), -1) + 1 AS s FROM batch_events WHERE batch_id = $1`, [batchId],
      )).rows[0].s));
      // Client-supplied created_at makes client-side signing possible; must be recent and parseable.
      let createdAt = new Date().toISOString();
      if (created_at) {
        const t = new Date(created_at);
        if (!Number.isNaN(t.valueOf()) && Math.abs(Date.now() - t.valueOf()) < 10 * 60_000) {
          createdAt = t.toISOString();
        }
      }
      const wireEvent = {
        batch_id: batchId, seq, event_type,
        actor_id: actor(req), actor_pubkey: actor_pubkey ?? null,
        to_stage: to_stage ?? null, payload, created_at: createdAt,
      };
      const payloadHash = canonicalHash(wireEvent);

      const prior = seq > 0
        ? ((await query<Record<string, unknown>>(
            `SELECT seq, payload_hash, actor_pubkey, actor_sig, batch_id FROM batch_events
             WHERE batch_id = $1 AND seq = $2`, [batchId, seq - 1],
          )).rows[0])
        : null;
      const prevHash = prior ? sha256Prev(prior) : null;

      // ── Dry-run: return the exact wire event + hashes so the client can sign it ──
      if (dry_run) {
        return reply.send({ wire_event: wireEvent, payload_hash: payloadHash, prev_hash: prevHash });
      }

      const { rows: inserted } = await query(
        `INSERT INTO batch_events (batch_id, seq, event_type, actor_id, actor_pubkey, actor_sig, prev_hash, payload_hash, to_stage, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *`,
        [batchId, seq, event_type, actor(req), actor_pubkey ?? null, actor_sig ?? null, prevHash, payloadHash, to_stage ?? null, JSON.stringify(payload)],
      );

      // ── Apply consequences: stage advance and custody transfer ──
      let batch = batchRow;
      if (to_stage && STAGES.includes(to_stage as Stage)) {
        batch = (await query(
          `UPDATE batches SET current_stage = $2, updated_at = now() WHERE id = $1 RETURNING *`,
          [batchId, to_stage],
        )).rows[0];
      }
      if (event_type === 'CUSTODY_TRANSFER' && (payload as { to_entity_id?: string }).to_entity_id) {
        batch = (await query(
          `UPDATE batches SET current_holder_id = $2 WHERE id = $1 RETURNING *`,
          [batchId, (payload as { to_entity_id: string }).to_entity_id],
        )).rows[0];
      }

      reply.code(201).send({ event: inserted[0], batch });
    },
  );
}

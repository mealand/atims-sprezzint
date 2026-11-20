import { query, actor } from '../db/pool.js';
import { checkClientEvent, DEFAULT_CORRIDOR, isStage } from '../services/gates.js';
import { evaluateBatchGate, nextGate } from '../services/gateFacts.js';
import { canonicalHash, type Stage, type Role } from '@atims/shared';
import { nextLink } from '../services/appendEvent.js';
import { buildWireEvent, checkPubkey, checkSignedSubmission, resolveSignedCreatedAt } from '../services/signedEvent.js';
import { accessEntity, decide, guard, listVisibleBatches, loadBatch, requireAccess } from '../services/access.js';
import { nextLinkOn, withClient } from '../services/tx.js';
import corridorRoutes from './corridors.js';
import inspectorRoutes from './inspector.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';

interface CreateBody {
  commodity?: string; variety?: string; quantity?: number; unit?: string;
  production_date?: string; origin_state?: string; destination_country?: string; notes?: string;
  /** Corridor code (GET /corridors). Omitted: DEFAULT, the generic pre-corridor rules. */
  corridor?: string;
  /** The buyer named on the batch: an active account with the buyer role. */
  buyer_id?: string; buyer_nexus_id?: string;
}

interface CorridorRow { code: string; active: boolean; requires_buyer: boolean; destination_country: string | null }

type Fail = { status: number; code: string; error: string };
const STALE = { status: 409, code: 'STALE_EVENT', error: 'the batch changed while saving; request a new dry-run and sign again' } as const;
class Abort extends Error { constructor(readonly fail: Fail) { super(fail.error); } }
interface EventBody {
  event_type?: string; to_stage?: string; payload?: Record<string, unknown>;
  actor_pubkey?: string; actor_sig?: string; dry_run?: boolean; created_at?: string;
  /** seq of the dry-run wire event the client signed (detects a chain that moved meanwhile). */
  seq?: number;
}

export default async function batchRoutes(app: FastifyInstance) {
  // Corridor reference data and the inspector sign-off queue live in their own files.
  await app.register(corridorRoutes);
  await app.register(inspectorRoutes);

  /**
   * POST /batches: farmers create a batch on a corridor, naming its buyer.
   * The genesis event is server-attested. The batch row and genesis event are one transaction.
   */
  app.post<{ Body: CreateBody }>(
    '/batches',
    { onRequest: [app.authenticate, guard('create_batch')] },
    async (req: FastifyRequest<{ Body: CreateBody }>, reply) => {
      const { commodity, variety, quantity, unit, production_date, origin_state, destination_country, notes, buyer_id, buyer_nexus_id } = req.body ?? {};
      if (!commodity || !quantity || !unit || !production_date) {
        return reply.code(400).send({ error: 'commodity, quantity, unit, production_date required' });
      }

      const corridorCode = (req.body?.corridor ?? DEFAULT_CORRIDOR).trim().toUpperCase();
      const corridor = (await query<CorridorRow>(
        `SELECT code, active, requires_buyer, destination_country FROM corridors WHERE code = $1`, [corridorCode],
      )).rows[0];
      if (!corridor || !corridor.active) {
        return reply.code(400).send({ status: 400, code: 'UNKNOWN_CORRIDOR', error: `unknown corridor ${corridorCode}; see GET /corridors` });
      }

      let buyerId: string | null = null;
      if (buyer_id || buyer_nexus_id) {
        const buyer = (await query<{ id: string; role: Role; status: string }>(
          `SELECT id, role, status FROM entities WHERE ${buyer_id ? 'id::text = $1' : 'nexus_id = upper($1)'}`,
          [buyer_id ?? buyer_nexus_id],
        )).rows[0];
        if (!buyer || buyer.status !== 'verified') {
          return reply.code(400).send({ status: 400, code: 'UNKNOWN_BUYER', error: 'no active account with that buyer id' });
        }
        if (buyer.role !== 'buyer') {
          return reply.code(400).send({ status: 400, code: 'NOT_A_BUYER', error: `that account is a ${buyer.role}, not a buyer` });
        }
        buyerId = buyer.id;
      } else if (corridor.requires_buyer) {
        return reply.code(400).send({ status: 400, code: 'BUYER_REQUIRED', error: `corridor ${corridor.code} needs the buyer named at creation (buyer_id or buyer_nexus_id)` });
      }

      const traceId = `CROP-${new Date().getFullYear()}-${canonicalHash({ commodity, quantity, production_date, actor: actor(req), r: Math.random() }).slice(0, 8).toUpperCase()}`;

      const out = await withClient(async (client) => {
        await client.query('BEGIN');
        try {
          const { rows } = await client.query<Record<string, unknown>>(
            `INSERT INTO batches (trace_id, origin_entity_id, commodity, variety, quantity, unit, production_date,
                origin_state, current_stage, current_holder_id, destination_country, notes, corridor, buyer_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'HARVESTED',$2,$9,$10,$11,$12)
             RETURNING *`,
            [traceId, actor(req), commodity, variety ?? null, quantity, unit, production_date, origin_state ?? null,
              destination_country ?? corridor.destination_country ?? null, notes ?? null, corridor.code, buyerId],
          );
          const batch = rows[0];

          const payload = { created: { commodity, quantity, unit, production_date } };
          const genesisCreatedAt = new Date().toISOString();
          const wire = {
            batch_id: batch.id, seq: 0, event_type: 'BATCH_CREATED', actor_id: actor(req),
            actor_pubkey: null, to_stage: 'HARVESTED', payload, created_at: genesisCreatedAt,
          };
          const payloadHash = canonicalHash(wire);
          const { rows: evRows } = await client.query(
            `INSERT INTO batch_events (batch_id, seq, event_type, actor_id, payload_hash, to_stage, payload, created_at)
             VALUES ($1, 0, 'BATCH_CREATED', $2, $3, 'HARVESTED', $4::jsonb, $5) RETURNING id, created_at`,
            [batch.id, actor(req), payloadHash, JSON.stringify(payload), genesisCreatedAt],
          );
          await client.query('COMMIT');
          return { batch, genesis_event: evRows[0] };
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        }
      });
      reply.code(201).send(out);
    },
  );

  /** GET /batches: every batch the caller may view (see access.ts view_batch). */
  app.get('/batches', { onRequest: [app.authenticate] }, async (req, reply) => {
    reply.send({ batches: await listVisibleBatches(accessEntity(req)) });
  });

  /** GET /batches/:id: batch + events + evidence, for parties to the batch (access.ts view_batch). */
  app.get<{ Params: { id: string } }>('/batches/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const loaded = await loadBatch(req.params.id);
    if (!loaded) return reply.code(404).send({ error: 'batch not found' });
    if (!requireAccess(req, reply, 'view_batch', loaded.parties)) return;
    const batch = loaded.row;
    const events = (await query(`SELECT * FROM batch_events WHERE batch_id = $1 ORDER BY seq ASC`, [batch.id])).rows;
    const evidence = (await query(
      `SELECT e.*, ent.role AS issued_by_role FROM evidence e JOIN entities ent ON ent.id = e.actor_id
       WHERE e.batch_id = $1 ORDER BY e.created_at`, [batch.id],
    )).rows;
    const assignments = (await query(
      `SELECT ba.entity_id, ent.nexus_id, ent.name, ent.role, ent.trust_tier, ba.created_at
         FROM batch_assignments ba JOIN entities ent ON ent.id = ba.entity_id
        WHERE ba.batch_id = $1 ORDER BY ba.created_at`, [batch.id],
    )).rows;
    reply.send({ batch, events, evidence, assignments, next_gate: await nextGate(batch) });
  });

  /**
   * GET /batches/:id/gate?to_stage=: the gate report (checklist with who must
   * supply each item) for the next stage, or for a named stage. Read-only.
   */
  app.get<{ Params: { id: string }; Querystring: { to_stage?: string } }>(
    '/batches/:id/gate', { onRequest: [app.authenticate] },
    async (req, reply) => {
      const loaded = await loadBatch(req.params.id);
      if (!loaded) return reply.code(404).send({ error: 'batch not found' });
      if (!requireAccess(req, reply, 'view_batch', loaded.parties)) return;
      const batch = loaded.row;
      const toStage = req.query.to_stage;
      if (toStage) {
        if (!isStage(toStage)) return reply.code(400).send({ status: 400, code: 'UNKNOWN_STAGE', error: `unknown stage ${toStage}` });
        return reply.send({ current_stage: batch.current_stage, gate: await evaluateBatchGate(batch, toStage) });
      }
      reply.send({ current_stage: batch.current_stage, gate: await nextGate(batch) });
    },
  );

  /**
   * POST /batches/:id/assignments { entity_id | nexus_id }: the current holder
   * assigns a lab or inspector, who can then view the batch and add its own reports.
   */
  app.post<{ Params: { id: string }; Body: { entity_id?: string; nexus_id?: string } }>(
    '/batches/:id/assignments', { onRequest: [app.authenticate] },
    async (req, reply) => {
      const loaded = await loadBatch(req.params.id);
      if (!loaded) return reply.code(404).send({ error: 'batch not found' });
      const { entity_id, nexus_id } = req.body ?? {};
      if (!entity_id && !nexus_id) return reply.code(400).send({ error: 'entity_id or nexus_id required' });
      const target = (await query<{ id: string; role: Role; status: string }>(
        `SELECT id, role, status FROM entities WHERE ${entity_id ? 'id::text = $1' : 'nexus_id = upper($1)'}`,
        [entity_id ?? nexus_id],
      )).rows[0];
      if (!target || target.status !== 'verified') return reply.code(404).send({ error: 'no active account with that id' });
      if (!requireAccess(req, reply, 'assign_party', loaded.parties, { target })) return;
      await query(
        `INSERT INTO batch_assignments (batch_id, entity_id, assigned_by) VALUES ($1, $2, $3)
         ON CONFLICT (batch_id, entity_id) DO NOTHING`,
        [loaded.parties.id, target.id, actor(req)],
      );
      await query(`INSERT INTO audit_log (actor_id, action, detail) VALUES ($1, 'batch.assign', $2)`,
        [actor(req), { batch: loaded.parties.id, target: target.id, role: target.role }]);
      reply.code(201).send({ batch_id: loaded.parties.id, entity_id: target.id, role: target.role });
    },
  );

  /**
   * POST /batches/:id/events: the client-signed write path.
   *
   * Allowed event types (F4): STAGE_ADVANCE and NOTE (current holder),
   * INSPECTION_SIGNOFF (assigned inspector), DELIVERY_CONFIRMED (the named buyer).
   * BATCH_CREATED, GATE_REJECTED, CUSTODY_TRANSFER and EVIDENCE_ADDED are
   * server-only; custody moves only through the handover flow (F3).
   * A stage advance must be to the next stage, and passes the corridor gate.
   *
   * dry_run: returns the wire event to sign, or 422 with the gate report. Never writes.
   * final: verified signature, then one transaction that locks the batch row,
   * re-checks the stage and the caller's right to act, and appends.
   */
  app.post<{ Params: { id: string }; Body: EventBody }>(
    '/batches/:id/events',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest<{ Params: { id: string }; Body: EventBody }>, reply) => {
      const loaded = await loadBatch(req.params.id);
      if (!loaded) return reply.code(404).send({ error: 'batch not found' });
      const batchRow = loaded.row;
      if (batchRow.compliance_status === 'blocked') return reply.code(409).send({ error: 'batch is blocked by a failed gate' });

      const body = (req.body ?? {}) as EventBody;
      const { payload, actor_pubkey, actor_sig, dry_run, created_at, seq: seqSigned } = body;
      const currentStage = String(batchRow.current_stage);

      const checked = checkClientEvent(body, currentStage);
      if ('status' in checked) return reply.code(checked.status).send(checked);
      const { action, eventType } = checked;
      const toStage = eventType === 'STAGE_ADVANCE' ? (body.to_stage as Stage) : null;

      if (!requireAccess(req, reply, action, loaded.parties)) return;

      // ── Every client event is signed by a device key (F1) ──
      const badKey = checkPubkey(actor_pubkey);
      if (badKey) return reply.code(badKey.status).send(badKey);

      const batchId = String(batchRow.id);

      // ── Corridor stage gate ──
      if (toStage) {
        const gate = await evaluateBatchGate(batchRow, toStage);
        if (!gate.pass) {
          // A dry-run is a question, not an attempt: answer with the report, write nothing.
          if (dry_run) return reply.code(422).send({ status: 422, code: 'GATE_FAILED', error: 'gate failed', gate, recorded: false });
          const gateLink = await nextLink(batchId);
          const gatePayload = { gate };
          const gateCreatedAt = new Date().toISOString();
          const gateHash = canonicalHash({
            batch_id: batchId, seq: gateLink.seq, event_type: 'GATE_REJECTED', actor_id: actor(req),
            actor_pubkey: null, to_stage: toStage, payload: gatePayload, created_at: gateCreatedAt,
          });
          try {
            await query(
              `INSERT INTO batch_events (batch_id, seq, event_type, actor_id, prev_hash, payload_hash, to_stage, payload, created_at)
               VALUES ($1, $2, 'GATE_REJECTED', $3, $4, $5, $6, $7::jsonb, $8)`,
              [batchId, gateLink.seq, actor(req), gateLink.prev_hash, gateHash, toStage, JSON.stringify(gatePayload), gateCreatedAt],
            );
          } catch (err) {
            if ((err as { code?: string }).code !== '23505') throw err; // lost a seq race: the report still stands
          }
          return reply.code(422).send({ status: 422, code: 'GATE_FAILED', error: 'gate failed', gate, recorded: true });
        }
      }

      // ── Dry-run: the server fixes created_at and returns the exact wire event to sign ──
      if (dry_run) {
        const { seq, prev_hash: prevHash } = await nextLink(batchId);
        const wireEvent = buildWireEvent({
          batchId, seq, eventType, actorId: actor(req), actorPubkey: actor_pubkey as string,
          toStage, payload, createdAt: new Date().toISOString(),
        });
        return reply.send({ wire_event: wireEvent, payload_hash: canonicalHash(wireEvent), prev_hash: prevHash });
      }

      // Final: the client echoes the dry-run's created_at; it is validated, never silently
      // replaced, because changing any signed field would invalidate the signature.
      const ts = resolveSignedCreatedAt(created_at);
      if ('status' in ts) return reply.code(ts.status).send(ts);

      try {
        const out = await withClient(async (client) => {
          await client.query('BEGIN');
          try {
            const locked = (await client.query<Record<string, unknown>>(
              `SELECT * FROM batches WHERE id = $1 FOR UPDATE`, [batchId],
            )).rows[0];
            // Custody or stage moved since we checked: the signed event may no longer be valid.
            if (!locked || String(locked.current_stage) !== currentStage) throw new Abort(STALE);
            const parties = { ...loaded.parties, current_holder_id: String(locked.current_holder_id) };
            const d = decide(accessEntity(req), action, parties);
            if (!d.allow) throw new Abort({ status: 403, code: 'FORBIDDEN', error: d.reason });

            const { seq, prev_hash: prevHash } = await nextLinkOn(client, batchId);
            const wireEvent = buildWireEvent({
              batchId, seq, eventType, actorId: actor(req), actorPubkey: actor_pubkey as string,
              toStage, payload, createdAt: ts.value,
            });
            // Reject before insert: a stored bad signature would mark the batch as tampered forever.
            const rejected = checkSignedSubmission({ wire: wireEvent, actorSig: actor_sig, clientSeq: seqSigned });
            if (rejected) throw new Abort(rejected);

            const inserted = (await client.query(
              `INSERT INTO batch_events (batch_id, seq, event_type, actor_id, actor_pubkey, actor_sig, prev_hash, payload_hash, to_stage, payload, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`,
              [batchId, seq, eventType, actor(req), actor_pubkey, actor_sig, prevHash, canonicalHash(wireEvent), toStage, JSON.stringify(payload), ts.value],
            )).rows[0];

            let batch = locked;
            if (toStage) {
              batch = (await client.query(
                `UPDATE batches SET current_stage = $2, updated_at = now() WHERE id = $1 RETURNING *`,
                [batchId, toStage],
              )).rows[0];
            }
            await client.query('COMMIT');
            return { event: inserted, batch };
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
          }
        });
        reply.code(201).send(out);
      } catch (err) {
        if (err instanceof Abort) return reply.code(err.fail.status).send(err.fail);
        // Another event took this seq between our read and insert: the client must re-sign.
        if ((err as { code?: string }).code === '23505') return reply.code(409).send(STALE);
        throw err;
      }
    },
  );
}

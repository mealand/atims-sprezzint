import { query, actor } from '../db/pool.js';
import { evaluateGate, type StageRequirementRow } from '../services/gates.js';
import { canonicalHash, STAGES, type Stage, type Role } from '@atims/shared';
import { nextLink } from '../services/appendEvent.js';
import { buildWireEvent, checkPubkey, checkSignedSubmission, resolveSignedCreatedAt } from '../services/signedEvent.js';
import { accessEntity, guard, listVisibleBatches, loadBatch, requireAccess } from '../services/access.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface CreateBody {
  commodity?: string; variety?: string; quantity?: number; unit?: string;
  production_date?: string; origin_state?: string; destination_country?: string; notes?: string;
}
interface EventBody {
  event_type?: string; to_stage?: string; payload?: Record<string, unknown>;
  actor_pubkey?: string; actor_sig?: string; dry_run?: boolean; created_at?: string;
  /** seq of the dry-run wire event the client signed (detects a chain that moved meanwhile). */
  seq?: number;
}

export default async function batchRoutes(app: FastifyInstance) {
  /** POST /batches — farmers create a batch; genesis event recorded (server-attested). */
  app.post<{ Body: CreateBody }>(
    '/batches',
    { onRequest: [app.authenticate, guard('create_batch')] },
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
      const genesisCreatedAt = new Date().toISOString();
      const wire = {
        batch_id: batch.id, seq: 0, event_type: 'BATCH_CREATED', actor_id: actor(req),
        actor_pubkey: null, to_stage: 'HARVESTED', payload, created_at: genesisCreatedAt,
      };
      const payloadHash = canonicalHash(wire);
      const { rows: evRows } = await query(
        `INSERT INTO batch_events (batch_id, seq, event_type, actor_id, payload_hash, to_stage, payload, created_at)
         VALUES ($1, 0, 'BATCH_CREATED', $2, $3, 'HARVESTED', $4::jsonb, $5) RETURNING id, created_at`,
        [batch.id, actor(req), payloadHash, JSON.stringify(payload), genesisCreatedAt],
      );
      reply.code(201).send({ batch, genesis_event: evRows[0] });
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
    reply.send({ batch, events, evidence, assignments });
  });

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
   * POST /batches/:id/events — the core write path.
   * Only the current holder appends. Stage advance is gate-enforced (422 with gate report on failure).
   */
  app.post<{ Params: { id: string }; Body: EventBody }>(
    '/batches/:id/events',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest<{ Params: { id: string }; Body: EventBody }>, reply) => {
      const loaded = await loadBatch(req.params.id);
      if (!loaded) return reply.code(404).send({ error: 'batch not found' });
      const batchRow = loaded.row;
      if (batchRow.compliance_status === 'blocked') return reply.code(409).send({ error: 'batch is blocked by a failed gate' });

      const { event_type, to_stage, payload, actor_pubkey, actor_sig, dry_run, created_at, seq: seqSigned } =
        (req.body ?? {}) as EventBody;
      if (!event_type || !payload) return reply.code(400).send({ error: 'event_type and payload required' });

      if (!requireAccess(req, reply, 'append_event', loaded.parties)) return;

      // ── Every client event is signed by a device key (F1) ──
      const badKey = checkPubkey(actor_pubkey);
      if (badKey) return reply.code(badKey.status).send(badKey);

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
          const gateLink = await nextLink(batchId);
          const gatePayload = { gate };
          const gateCreatedAt = new Date().toISOString();
          const gateHash = canonicalHash({
            batch_id: batchId, seq: gateLink.seq, event_type: 'GATE_REJECTED', actor_id: actor(req),
            actor_pubkey: null, to_stage: to_stage, payload: gatePayload, created_at: gateCreatedAt,
          });
          await query(
            `INSERT INTO batch_events (batch_id, seq, event_type, actor_id, prev_hash, payload_hash, to_stage, payload, created_at)
             VALUES ($1, $2, 'GATE_REJECTED', $3, $4, $5, $6, $7::jsonb, $8)`,
            [batchId, gateLink.seq, actor(req), gateLink.prev_hash, gateHash, to_stage, JSON.stringify(gatePayload), gateCreatedAt],
          );
          return reply.code(422).send({ error: 'gate failed', gate });
        }
      }

      // ── Append the event on the hash chain ──
      const { seq, prev_hash: prevHash } = await nextLink(batchId);

      // Dry-run: the server fixes created_at and returns the exact wire event to sign.
      // Final: the client echoes that created_at; it is validated, never silently replaced,
      // because changing any signed field would invalidate the signature.
      let createdAt: string;
      if (dry_run) {
        createdAt = new Date().toISOString();
      } else {
        const ts = resolveSignedCreatedAt(created_at);
        if ('status' in ts) return reply.code(ts.status).send(ts);
        createdAt = ts.value;
      }
      const wireEvent = buildWireEvent({
        batchId, seq, eventType: event_type, actorId: actor(req), actorPubkey: actor_pubkey as string,
        toStage: to_stage ?? null, payload, createdAt,
      });
      const payloadHash = canonicalHash(wireEvent);

      if (dry_run) {
        return reply.send({ wire_event: wireEvent, payload_hash: payloadHash, prev_hash: prevHash });
      }

      // Reject before insert: a stored bad signature would mark the batch as tampered forever.
      const rejected = checkSignedSubmission({ wire: wireEvent, actorSig: actor_sig, clientSeq: seqSigned });
      if (rejected) return reply.code(rejected.status).send(rejected);

      let inserted: Record<string, unknown>[];
      try {
        inserted = (await query(
          `INSERT INTO batch_events (batch_id, seq, event_type, actor_id, actor_pubkey, actor_sig, prev_hash, payload_hash, to_stage, payload, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`,
          [batchId, seq, event_type, actor(req), actor_pubkey, actor_sig, prevHash, payloadHash, to_stage ?? null, JSON.stringify(payload), createdAt],
        )).rows;
      } catch (err) {
        // Another event took this seq between our read and insert: the client must re-sign.
        if ((err as { code?: string }).code === '23505') {
          return reply.code(409).send({ status: 409, code: 'STALE_EVENT', error: 'the batch changed while saving; request a new dry-run and sign again' });
        }
        throw err;
      }

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

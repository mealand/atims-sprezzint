import { query, actor } from '../db/pool.js';
import { canonicalHash } from '@atims/shared';
import { nextLink } from '../services/appendEvent.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface EvidenceBody {
  evidence_type?: string; file_hash?: string; issued_by_role?: string; object_key?: string; meta?: unknown;
}

/** POST /batches/:id/evidence + GET — evidence registration is itself an event on the chain. */
export default async function evidenceRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: EvidenceBody }>(
    '/batches/:id/evidence',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest<{ Params: { id: string }; Body: EvidenceBody }>, reply) => {
      const batch = (await query<{ id: string }>(`SELECT id FROM batches WHERE id::text = $1`, [req.params.id])).rows[0];
      if (!batch) return reply.code(404).send({ error: 'batch not found' });
      const { evidence_type, file_hash, issued_by_role, object_key, meta } = req.body ?? {};
      if (!evidence_type || !file_hash || !/^[a-f0-9]{64}$/.test(file_hash)) {
        return reply.code(400).send({ error: 'evidence_type and 64-hex file_hash required' });
      }
      const payload = { evidence_type, file_hash, issued_by_role: issued_by_role ?? null, object_key: object_key ?? null, meta: meta ?? {} };
      // Compute seq first, then insert with the full wire shape — no UPDATE on the append-only ledger.
      const { seq: evSeq, prev_hash: evPrev } = await nextLink(batch.id);
      const evCreatedAt = new Date().toISOString();
      const wireHash = canonicalHash({
        batch_id: batch.id, seq: evSeq, event_type: 'EVIDENCE_ADDED', actor_id: actor(req),
        actor_pubkey: null, to_stage: null, payload, created_at: evCreatedAt,
      });
      const { rows: ev } = await query<{ id: string }>(
        `INSERT INTO batch_events (batch_id, seq, event_type, actor_id, prev_hash, payload_hash, to_stage, payload, created_at)
         VALUES ($1, $2, 'EVIDENCE_ADDED', $3, $4, $5, NULL, $6::jsonb, $7) RETURNING id`,
        [batch.id, evSeq, actor(req), evPrev, wireHash, JSON.stringify(payload), evCreatedAt],
      );
      const { rows: ins } = await query(
        `INSERT INTO evidence (batch_id, event_id, actor_id, evidence_type, file_hash, object_key, issued_by_role, meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
        [batch.id, ev[0].id, actor(req), evidence_type, file_hash, object_key ?? null, issued_by_role ?? req.entity?.role ?? null, JSON.stringify(meta ?? {})],
      );
      reply.code(201).send({ evidence: ins[0], event_id: ev[0].id });
    },
  );

  /** GET /batches/:id/evidence — actors and inspectors */
  app.get<{ Params: { id: string } }>(
    '/batches/:id/evidence',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { rows } = await query(
        `SELECT e.*, ent.nexus_id AS issuer_nexus_id, ent.role AS issuer_role
         FROM evidence e JOIN entities ent ON ent.id = e.actor_id
         WHERE e.batch_id::text = $1 ORDER BY e.created_at ASC`,
        [req.params.id],
      );
      reply.send({ evidence: rows });
    },
  );
}

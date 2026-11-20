import { query, actor } from '../db/pool.js';
import { canonicalHash } from '@atims/shared';
import { nextLink } from '../services/appendEvent.js';
import { presignUpload, presignDownload, storageEnabled } from '../services/storage.js';
import { loadBatch, requireAccess } from '../services/access.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';

interface EvidenceBody {
  evidence_type?: string; file_hash?: string; meta?: unknown;
  /** true when the file was PUT to the presigned upload URL. The key itself is derived here. */
  stored?: boolean;
  /** Legacy: a client-sent key only signals "stored"; its value is ignored. */
  object_key?: string;
}

/** POST /batches/:id/evidence + GET — evidence registration is itself an event on the chain. */
export default async function evidenceRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: EvidenceBody }>(
    '/batches/:id/evidence',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest<{ Params: { id: string }; Body: EvidenceBody }>, reply) => {
      const loaded = await loadBatch(req.params.id);
      if (!loaded) return reply.code(404).send({ error: 'batch not found' });
      const batch = { id: loaded.parties.id };
      const { evidence_type, file_hash, meta, stored, object_key: legacyKey } = req.body ?? {};
      if (!evidence_type || !file_hash || !/^[a-f0-9]{64}$/.test(file_hash)) {
        return reply.code(400).send({ error: 'evidence_type and 64-hex file_hash required' });
      }
      if (!requireAccess(req, reply, 'add_evidence', loaded.parties, { evidence_type })) return;
      // Never trust the client for who issued it or where it lives (assessment F5).
      const issuedByRole = req.entity!.role;
      const objectKey = storageEnabled && (stored === true || Boolean(legacyKey))
        ? (await presignUpload(actor(req), batch.id, file_hash)).object_key
        : null;
      const payload = { evidence_type, file_hash, issued_by_role: issuedByRole, object_key: objectKey, meta: meta ?? {} };
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
        [batch.id, ev[0].id, actor(req), evidence_type, file_hash, objectKey, issuedByRole, JSON.stringify(meta ?? {})],
      );
      reply.code(201).send({ evidence: ins[0], event_id: ev[0].id });
    },
  );

  /** GET /batches/:id/evidence: parties to the batch (access.ts view_batch). */
  app.get<{ Params: { id: string } }>(
    '/batches/:id/evidence',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const loaded = await loadBatch(req.params.id);
      if (!loaded) return reply.code(404).send({ error: 'batch not found' });
      if (!requireAccess(req, reply, 'view_batch', loaded.parties)) return;
      const { rows } = await query(
        `SELECT e.*, ent.nexus_id AS issuer_nexus_id, ent.role AS issuer_role
         FROM evidence e JOIN entities ent ON ent.id = e.actor_id
         WHERE e.batch_id = $1 ORDER BY e.created_at ASC`,
        [loaded.parties.id],
      );
      reply.send({ evidence: rows });
    },
  );

  /**
   * POST /batches/:id/evidence/upload-url — M3.2: presigned direct upload.
   * Client hashes the file locally first (the hash is the chain authority),
   * gets a presigned PUT for MinIO/S3 (optional), then registers the evidence.
   */
  app.post<{ Params: { id: string }; Body: { file_hash?: string; evidence_type?: string } }>(
    '/batches/:id/evidence/upload-url',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const loaded = await loadBatch(req.params.id);
      if (!loaded) return reply.code(404).send({ error: 'batch not found' });
      const { file_hash, evidence_type } = req.body ?? {};
      if (!file_hash || !/^[a-f0-9]{64}$/.test(file_hash) || !evidence_type) {
        return reply.code(400).send({ error: 'file_hash (64 hex) and evidence_type required' });
      }
      if (!requireAccess(req, reply, 'add_evidence', loaded.parties, { evidence_type })) return;
      const handle = await presignUpload(actor(req), loaded.parties.id, file_hash);
      reply.send({ ...handle, storage_enabled: storageEnabled });
    },
  );

  /**
   * GET /batches/:id/evidence/:evidenceId/url — presigned read URL for a stored
   * evidence object (browser-facing, uses the public MinIO endpoint). Parties to
   * the batch only (access.ts view_evidence_file); the row must belong to the batch.
   */
  app.get<{ Params: { id: string; evidenceId: string } }>(
    '/batches/:id/evidence/:evidenceId/url',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const loaded = await loadBatch(req.params.id);
      if (!loaded) return reply.code(404).send({ error: 'batch not found' });
      if (!requireAccess(req, reply, 'view_evidence_file', loaded.parties)) return;
      const { rows } = await query<{ object_key: string | null }>(
        `SELECT object_key FROM evidence WHERE id::text = $1 AND batch_id = $2`,
        [req.params.evidenceId, loaded.parties.id],
      );
      const row = rows[0];
      if (!row) return reply.code(404).send({ error: 'evidence not found' });
      if (!row.object_key) return reply.code(409).send({ error: 'hash-only evidence — no stored object' });
      try {
        const url = await presignDownload(row.object_key);
        if (!url) return reply.code(503).send({ error: 'storage not configured on this API instance' });
        reply.send({ url });
      } catch (e) {
        req.log.error({ err: e }, 'presignDownload failed');
        return reply.code(500).send({ error: `presign failed: ${(e as Error).message}` });
      }
    },
  );
}

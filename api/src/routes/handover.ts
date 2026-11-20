import { query, actor } from '../db/pool.js';
import { randomBytes } from 'node:crypto';
import { accessEntity, loadBatch, requireAccess } from '../services/access.js';
import { acceptHandover, type AcceptBody, type TokenRow } from '../services/handover.js';
import { withClient } from '../services/tx.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/** M3.1 QR custody handover (F3, F11). The current holder mints a one-time
 *  token; the receiver scans the QR (a /handover/accept?token= URL) and accepts
 *  with a signed CUSTODY_TRANSFER event. This is the only way custody moves:
 *  CUSTODY_TRANSFER is server-only on POST /batches/:id/events. */

/** Where the QR points: the frontend accept page. Relative when no public URL is configured. */
function acceptUrl(req: FastifyRequest, token: string): string {
  const path = `/handover/accept?token=${encodeURIComponent(token)}`;
  const origin = process.env.PUBLIC_APP_URL ?? req.headers.origin;
  return origin ? `${String(origin).replace(/\/$/, '')}${path}` : path;
}

export default async function handoverRoutes(app: FastifyInstance) {
  /** POST /batches/:id/handover/start — current holder mints a 1-hour token. */
  app.post<{ Params: { id: string } }>(
    '/batches/:id/handover/start',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const loaded = await loadBatch(req.params.id);
      if (!loaded) return reply.code(404).send({ error: 'batch not found' });
      if (!requireAccess(req, reply, 'start_handover', loaded.parties)) return;
      const batch = loaded.row;
      const token = randomBytes(24).toString('base64url');
      const { rows } = await query<{ id: string; expires_at: string }>(
        `INSERT INTO handover_tokens (batch_id, token, from_holder)
         VALUES ($1, $2, $3) RETURNING id, expires_at`,
        [batch.id, token, actor(req)],
      );
      reply.code(201).send({
        token,
        batch_id: batch.id,
        trace_id: batch.trace_id,
        expires_at: rows[0].expires_at,
        // QR payload: the full accept-page URL. HandoverAccept.tsx parses it
        // (and still accepts a bare token or the legacy atims://handover/<token>).
        handover_url: acceptUrl(req, token),
        accept_path: `/handover/accept?token=${encodeURIComponent(token)}`,
      });
    },
  );

  /** GET /handover/:token — preview (auth): what am I about to accept? */
  app.get<{ Params: { token: string } }>(
    '/handover/:token',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const t = (await query<TokenRow>(
        `SELECT * FROM handover_tokens WHERE token = $1`, [req.params.token],
      )).rows[0];
      if (!t) return reply.code(404).send({ error: 'handover token not found' });
      if (t.used_at) return reply.code(410).send({ error: 'handover token already used' });
      if (new Date(t.expires_at).valueOf() < Date.now()) return reply.code(410).send({ error: 'handover token expired' });
      const batch = (await query(
        `SELECT id, trace_id, commodity, quantity, unit, current_stage, origin_state,
                current_holder_id, origin_entity_id, corridor, buyer_id FROM batches WHERE id = $1`, [t.batch_id],
      )).rows[0];
      const from = (await query(`SELECT nexus_id, name, role FROM entities WHERE id = $1`, [t.from_holder])).rows[0];
      reply.send({ batch, from, expires_at: t.expires_at });
    },
  );

  /**
   * POST /handover/:token/accept: the receiver takes custody.
   * 1. { actor_pubkey, dry_run: true } returns the exact CUSTODY_TRANSFER wire event to sign; nothing is written.
   * 2. { actor_pubkey, actor_sig, created_at, seq } from that dry-run commits it in one transaction.
   */
  app.post<{ Params: { token: string }; Body: AcceptBody }>(
    '/handover/:token/accept',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest<{ Params: { token: string }; Body: AcceptBody }>, reply) => {
      let out;
      try {
        out = await withClient((client) => acceptHandover(client, {
          token: req.params.token,
          me: accessEntity(req),
          body: req.body ?? {},
          loadParties: async (batchId) => (await loadBatch(batchId))?.parties ?? null,
        }));
      } catch (err) {
        // Another event took this seq between our read and insert: the client must re-sign.
        if ((err as { code?: string }).code === '23505') {
          return reply.code(409).send({ status: 409, code: 'STALE_EVENT', error: 'the batch changed while saving; request a new dry-run and sign again' });
        }
        throw err;
      }
      if (out.kind === 'rejected') return reply.code(out.status).send({ status: out.status, code: out.code, error: out.error });
      if (out.kind === 'dry_run') {
        return reply.send({ wire_event: out.wire_event, payload_hash: out.payload_hash, prev_hash: out.prev_hash });
      }
      await query(`INSERT INTO audit_log (actor_id, action, detail) VALUES ($1, 'handover.accept', $2)`,
        [actor(req), { batch: out.batch.id, event: out.event.id }]);
      reply.send({ event: out.event, batch: out.batch });
    },
  );
}

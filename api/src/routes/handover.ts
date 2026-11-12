import { query, actor } from '../db/pool.js';
import { canonicalHash } from '@atims/shared';
import { nextLink } from '../services/appendEvent.js';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/** M3.1 — QR custody handover. Current holder mints a one-time token; the
 *  receiving entity scans it and accepts, appending a signed-chain
 *  CUSTODY_TRANSFER event that moves current_holder_id. */

interface TokenRow {
  id: string; batch_id: string; token: string; from_holder: string;
  used_at: string | null; used_by: string | null; expires_at: string;
}

export default async function handoverRoutes(app: FastifyInstance) {
  /** POST /batches/:id/handover/start — current holder mints a 1-hour token. */
  app.post<{ Params: { id: string } }>(
    '/batches/:id/handover/start',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const batch = (await query<Record<string, unknown>>(
        `SELECT * FROM batches WHERE id::text = $1 OR trace_id = $1`, [req.params.id],
      )).rows[0];
      if (!batch) return reply.code(404).send({ error: 'batch not found' });
      if (batch.current_holder_id !== actor(req)) {
        return reply.code(403).send({ error: 'only the current holder can start a handover' });
      }
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
        // QR payload: the accepting device hits the accept endpoint with this.
        handover_url: `atims://handover/${token}`,
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
                current_holder_id, origin_entity_id FROM batches WHERE id = $1`, [t.batch_id],
      )).rows[0];
      const from = (await query(`SELECT nexus_id, name, role FROM entities WHERE id = $1`, [t.from_holder])).rows[0];
      reply.send({ batch, from, expires_at: t.expires_at });
    },
  );

  /** POST /handover/:token/accept — receiving entity takes custody (chain event). */
  app.post<{ Params: { token: string }; Body: { actor_pubkey?: string; actor_sig?: string; created_at?: string } }>(
    '/handover/:token/accept',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest<{ Params: { token: string }; Body: { actor_pubkey?: string; actor_sig?: string; created_at?: string } }>, reply) => {
      const me = actor(req);
      const t = (await query<TokenRow>(
        `SELECT * FROM handover_tokens WHERE token = $1 FOR UPDATE`, [req.params.token],
      )).rows[0];
      if (!t) return reply.code(404).send({ error: 'handover token not found' });
      if (t.used_at) return reply.code(410).send({ error: 'handover token already used' });
      if (new Date(t.expires_at).valueOf() < Date.now()) return reply.code(410).send({ error: 'handover token expired' });
      if (t.from_holder === me) return reply.code(409).send({ error: 'cannot accept your own handover' });

      const batch = (await query<Record<string, unknown>>(
        `SELECT * FROM batches WHERE id = $1`, [t.batch_id],
      )).rows[0];
      if (!batch) return reply.code(404).send({ error: 'batch not found' });
      if (batch.current_holder_id !== t.from_holder) {
        return reply.code(409).send({ error: 'custody has moved since this token was issued' });
      }

      const payload = { to_entity_id: me, via: 'handover', token_id: t.id };
      const { seq, prev_hash: prevHash } = await nextLink(String(batch.id));
      const createdAt = req.body.created_at && !Number.isNaN(new Date(req.body.created_at).valueOf())
        ? new Date(req.body.created_at).toISOString() : new Date().toISOString();
      const wire = {
        batch_id: String(batch.id), seq, event_type: 'CUSTODY_TRANSFER',
        actor_id: me, actor_pubkey: req.body.actor_pubkey ?? null, to_stage: null,
        payload, created_at: createdAt,
      };
      const payloadHash = canonicalHash(wire);

      const { rows: ev } = await query(
        `INSERT INTO batch_events (batch_id, seq, event_type, actor_id, actor_pubkey, actor_sig, prev_hash, payload_hash, to_stage, payload, created_at)
         VALUES ($1,$2,'CUSTODY_TRANSFER',$3,$4,$5,$6,$7,NULL,$8::jsonb,$9) RETURNING *`,
        [batch.id, seq, me, req.body.actor_pubkey ?? null, req.body.actor_sig ?? null, prevHash, payloadHash, JSON.stringify(payload), createdAt],
      );
      await query(`UPDATE handover_tokens SET used_at = now(), used_by = $2 WHERE id = $1`, [t.id, me]);
      const updated = (await query(
        `UPDATE batches SET current_holder_id = $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [batch.id, me],
      )).rows[0];
      reply.send({ event: ev[0], batch: updated });
    },
  );
}

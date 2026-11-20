import { query, actor } from '../db/pool.js';
import { accessEntity, guard, requireAccess, withTrustTier } from '../services/access.js';
import { ROLES, TRUST_TIERS, type Role } from '@atims/shared';
import type { FastifyInstance } from 'fastify';

const LIST_COLS = `e.id, e.nexus_id, e.name, e.role, e.status, e.trust_tier, e.email, e.phone, e.profile,
  e.state_province, e.country, e.email_verified_at, e.kyb_verified_at, e.created_at,
  v.nexus_id AS verified_by_nexus_id, v.role AS verified_by_role`;

export default async function entityRoutes(app: FastifyInstance) {
  /** GET /entities/me: role, profile and trust tier of the logged-in account. */
  app.get('/entities/me', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { rows } = await query(
      `SELECT ${LIST_COLS} FROM entities e LEFT JOIN entities v ON v.id = e.verified_by WHERE e.id = $1`, [actor(req)],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not found' });
    reply.send({ entity: rows[0] });
  });

  /**
   * GET /entities?role=&trust_tier=: account list / KYB review queue.
   * Admins see everyone; KYB-verified inspectors see farmers only.
   */
  app.get<{ Querystring: { role?: string; trust_tier?: string } }>(
    '/entities', { onRequest: [app.authenticate] },
    async (req, reply) => {
      const me = await withTrustTier(accessEntity(req));
      if (!requireAccess(req, reply, 'list_entities', undefined, undefined, me)) return;
      const role = me.role === 'admin' ? req.query.role : 'farmer';
      const tier = req.query.trust_tier;
      if (role && !(ROLES as readonly string[]).includes(role)) return reply.code(400).send({ error: 'unknown role' });
      if (tier && !(TRUST_TIERS as readonly string[]).includes(tier)) return reply.code(400).send({ error: 'unknown trust_tier' });
      const { rows } = await query(
        `SELECT ${LIST_COLS} FROM entities e LEFT JOIN entities v ON v.id = e.verified_by
          WHERE ($1::text IS NULL OR e.role = $1) AND ($2::text IS NULL OR e.trust_tier = $2)
          ORDER BY e.created_at DESC LIMIT 200`,
        [role ?? null, tier ?? null],
      );
      reply.send({ entities: rows });
    },
  );

  /**
   * POST /entities/:id/kyb { decision: 'approve' | 'revoke', note? }
   * Approve sets kyb_verified and records who verified. Admins review anyone
   * but admins; KYB-verified inspectors review farmers.
   */
  app.post<{ Params: { id: string }; Body: { decision?: string; note?: string } }>(
    '/entities/:id/kyb', { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { decision, note } = req.body ?? {};
      if (decision !== 'approve' && decision !== 'revoke') {
        return reply.code(400).send({ error: "decision must be 'approve' or 'revoke'" });
      }
      const target = (await query<{ id: string; role: Role }>(
        `SELECT id, role FROM entities WHERE id::text = $1 OR nexus_id = upper($1)`, [req.params.id],
      )).rows[0];
      if (!target) return reply.code(404).send({ error: 'entity not found' });
      const me = await withTrustTier(accessEntity(req));
      if (!requireAccess(req, reply, 'review_kyb', undefined, { target }, me)) return;

      const sql = decision === 'approve'
        ? `UPDATE entities
              SET trust_tier = 'kyb_verified', kyb_verified_at = now(), verified_by = $2,
                  status = CASE WHEN status = 'pending' THEN 'verified' ELSE status END, updated_at = now()
            WHERE id = $1 RETURNING id, nexus_id, name, role, status, trust_tier, kyb_verified_at, verified_by`
        : `UPDATE entities
              SET trust_tier = CASE WHEN email_verified_at IS NOT NULL THEN 'self_verified' ELSE 'registered' END,
                  status = CASE WHEN email_verified_at IS NULL AND status = 'verified' THEN 'pending' ELSE status END,
                  kyb_verified_at = NULL, verified_by = NULL, updated_at = now()
            WHERE id = $1 RETURNING id, nexus_id, name, role, status, trust_tier, kyb_verified_at, verified_by`;
      const { rows } = await query(sql, decision === 'approve' ? [target.id, me.id] : [target.id]);
      await query(`INSERT INTO audit_log (actor_id, action, detail) VALUES ($1, $2, $3)`,
        [me.id, `entity.kyb_${decision}`, { target: target.id, note: note ?? null }]);
      reply.send({ entity: rows[0] });
    },
  );

  /**
   * POST /entities/:id/lifecycle { action: 'verify' | 'suspend' | 'reject' }: admin.
   * 'verify' is a KYB approval (kept for the existing admin dashboard).
   */
  app.post<{ Params: { id: string }; Body: { action?: 'verify' | 'suspend' | 'reject' } }>(
    '/entities/:id/lifecycle',
    { onRequest: [app.authenticate, guard('manage_entities')] },
    async (req, reply) => {
      const action = req.body?.action;
      const sql = {
        verify: `UPDATE entities SET status = 'verified', trust_tier = 'kyb_verified', kyb_verified_at = now(),
                   verified_by = $2, updated_at = now() WHERE id = $1`,
        suspend: `UPDATE entities SET status = 'suspended', updated_at = now() WHERE id = $1 AND id <> $2`,
        reject: `UPDATE entities SET status = 'rejected', updated_at = now() WHERE id = $1 AND id <> $2`,
      }[action as string];
      if (!sql) return reply.code(400).send({ error: 'action must be verify|suspend|reject' });
      const { rows } = await query(
        `${sql} RETURNING id, nexus_id, name, role, status, trust_tier`, [req.params.id, actor(req)],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'entity not found (admins cannot suspend or reject themselves)' });
      await query(`INSERT INTO audit_log (actor_id, action, detail) VALUES ($1, $2, $3)`,
        [actor(req), `entity.${action}`, { target: req.params.id }]);
      reply.send({ entity: rows[0] });
    },
  );
}

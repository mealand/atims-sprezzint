import { query, actor } from '../db/pool.js';
import type { Role } from '@atims/shared';

export default async function entityRoutes(app: import('fastify').FastifyInstance) {
  /** GET /entities/me */
  app.get('/entities/me', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { rows } = await query(`SELECT id, nexus_id, name, role, status, country, created_at FROM entities WHERE id = $1`, [actor(req)]);
    if (!rows[0]) return reply.code(404).send({ error: 'not found' });
    reply.send({ entity: rows[0] });
  });

  /** GET /entities — admin only (verification queue) */
  app.get('/entities', { onRequest: [app.authenticate, app.requireRole('admin')] }, async (req, reply) => {
    const { rows } = await query(`SELECT id, nexus_id, name, role, status, country, created_at FROM entities ORDER BY created_at DESC LIMIT 100`);
    reply.send({ entities: rows });
  });

  /** POST /entities/:id/verify | /suspend | /reject — admin */
  app.post<{ Params: { id: string }; Body: { action: 'verify' | 'suspend' | 'reject' } }>(
    '/entities/:id/lifecycle',
    { onRequest: [app.authenticate, app.requireRole('admin')] },
    async (req, reply) => {
      const statusMap = { verify: 'verified', suspend: 'suspended', reject: 'rejected' } as const;
      const newStatus = statusMap[req.body.action];
      if (!newStatus) return reply.code(400).send({ error: 'action must be verify|suspend|reject' });
      const { rows } = await query(
        `UPDATE entities SET status = $2, updated_at = now() WHERE id = $1
         RETURNING id, nexus_id, name, role, status`,
        [req.params.id, newStatus],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'entity not found' });
      await query(`INSERT INTO audit_log (actor_id, action, detail) VALUES ($1, $2, $3)`,
        [actor(req), `entity.${req.body.action}`, { target: req.params.id }]);
      reply.send({ entity: rows[0] });
    },
  );
}

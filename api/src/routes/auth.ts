import { query } from '../db/pool.js';
import { verifyPassword } from '../services/password.js';
import { canonicalHash } from '@atims/shared';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface RegisterBody { name?: string; role?: string; password?: string; state_province?: string; country?: string }
interface LoginBody { nexus_id?: string; password?: string }
interface ChangePasswordBody { current_password?: string; new_password?: string }

export default async function authRoutes(app: FastifyInstance) {
  /** POST /auth/register — anyone can self-register; status starts 'pending' until an admin verifies. */
  app.post<{ Body: RegisterBody }>('/auth/register', async (req: FastifyRequest<{ Body: RegisterBody }>, reply) => {
    const { name, role, password, state_province, country } = req.body ?? {};
    if (!name || !role || !password) return reply.code(400).send({ error: 'name, role and password are required' });

    const { rows } = await query(
      `SELECT count(*)::int AS c FROM entities WHERE role = $1`,
      [role],
    );
    // Nexus ID: NX-<role prefix>-<random 6 hex>
    const nexusId = `NX-${String(role).slice(0, 2).toUpperCase()}-${canonicalHash({ name, role, t: Date.now() }).slice(0, 6).toUpperCase()}`;

    const { rows: inserted } = await query(
      `INSERT INTO entities (nexus_id, name, role, password_hash, state_province, country)
       VALUES ($1, $2, $3, crypt($4, gen_salt('bf', 12)), $5, $6)
       RETURNING id, nexus_id, name, role, status, created_at`,
      [nexusId, name, role, password, state_province ?? null, country ?? 'NG'],
    );
    if (inserted.length === 0) return reply.code(500).send({ error: 'registration failed' });
    reply.code(201).send({ entity: inserted[0], message: 'Registered. Awaiting admin verification before you can sign batches.' });
  });

  /** POST /auth/password — change own password (any verified entity). */
  app.post<{ Body: ChangePasswordBody }>('/auth/password', { onRequest: [app.authenticate] },
    async (req: FastifyRequest<{ Body: ChangePasswordBody }>, reply) => {
      const { current_password, new_password } = req.body ?? {};
      if (!current_password || !new_password) {
        return reply.code(400).send({ error: 'current_password and new_password are required' });
      }
      if (typeof new_password !== 'string' || new_password.length < 10) {
        return reply.code(400).send({ error: 'new_password must be at least 10 characters' });
      }

      const { rows } = await query(
        `SELECT id, password_hash FROM entities WHERE id = $1`,
        [req.entity!.id],
      );
      const entity = rows[0];
      if (!entity || !(await verifyPassword(String(current_password), String(entity.password_hash)))) {
        return reply.code(401).send({ error: 'current password is incorrect' });
      }

      await query(
        `UPDATE entities SET password_hash = crypt($2, gen_salt('bf', 12)) WHERE id = $1`,
        [entity.id, new_password],
      );
      reply.send({ ok: true, message: 'password updated' });
    },
  );

  /** POST /auth/login */
  app.post<{ Body: LoginBody }>('/auth/login', async (req: FastifyRequest<{ Body: LoginBody }>, reply) => {
    const { nexus_id, password } = req.body ?? {};
    if (!nexus_id || !password) return reply.code(400).send({ error: 'nexus_id and password required' });

    const { rows } = await query(
      `SELECT id, nexus_id, name, role, status, password_hash FROM entities WHERE nexus_id = $1`,
      [String(nexus_id).toUpperCase()],
    );
    const entity = rows[0];
    if (!entity || !(await verifyPassword(String(password), String(entity.password_hash)))) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    if (entity.status !== 'verified') {
      return reply.code(403).send({ error: `account ${entity.status} — awaiting verification` });
    }
    const token = app.jwt.sign({ sub: entity.id });
    reply.send({
      token,
      entity: { id: entity.id, nexus_id: entity.nexus_id, name: entity.name, role: entity.role, status: entity.status },
    });
  });
}

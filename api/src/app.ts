import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import { env, isProd } from './config.js';
import { actor } from './db/pool.js';
import { logger } from './utils/logger.js';
import { pool } from './db/pool.js';

export async function buildApp() {
  const app = Fastify({ loggerInstance: logger });

  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGINS.split(',') });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: env.JWT_EXPIRES_IN } });

  // ── Auth decorators ──────────────────────────────────────
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'invalid or missing token' });
    }
    const { rows } = await pool.query(
      `SELECT id, nexus_id, name, role, status FROM entities WHERE id = $1 AND status = 'verified'`,
      [actor(req)],
    );
    const entity = rows[0];
    if (!entity) return reply.code(403).send({ error: 'no verified entity for this token' });
    req.entity = entity;
  });

  app.decorate('requireRole', (...roles: string[]) => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.entity || !roles.includes(req.entity.role)) {
      return reply.code(403).send({ error: 'insufficient role' });
    }
  });

  await app.register(import('./routes/auth.js'));
  await app.register(import('./routes/entities.js'));
  await app.register(import('./routes/batches.js'));
  await app.register(import('./routes/evidence.js'));
  await app.register(import('./routes/trace.js'));
  await app.register(import('./routes/ai.js'));

  return app;
}

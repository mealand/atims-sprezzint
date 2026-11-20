/**
 * Route-level checks that run before any database access, so CI needs no
 * Postgres. (The pg pool connects lazily; these requests never reach it.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

process.env.JWT_SECRET ??= 'test-secret-at-least-16-chars';
process.env.NODE_ENV ??= 'test';

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  const { pool } = await import('../src/db/pool.js');
  await pool.end();
});

const account = { name: 'Root', email: 'root@example.com', password: 'a-long-enough-password' };

describe('POST /auth/register', () => {
  it('refuses admin self-registration with 403', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { ...account, role: 'admin', profile: {} } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'ADMIN_NOT_SELF_REGISTRABLE' });
  });

  it('refuses admin even with a plausible profile', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { ...account, role: 'admin', profile: { agency: 'NAFDAC', staff_id: 'NF-1' } },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an unknown role and an incomplete profile with field issues', async () => {
    const unknown = await app.inject({ method: 'POST', url: '/auth/register', payload: { ...account, role: 'king', profile: {} } });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ code: 'UNKNOWN_ROLE' });

    const incomplete = await app.inject({ method: 'POST', url: '/auth/register', payload: { ...account, role: 'exporter', profile: { cac_number: 'RC123456' } } });
    expect(incomplete.statusCode).toBe(400);
    const paths = (incomplete.json() as { issues: Array<{ path: string }> }).issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['profile.nepc_number', 'profile.tin']));
  });
});

describe('auth input validation', () => {
  it('verify-email and resend-code require an identity', async () => {
    expect((await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { code: '123456' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/auth/resend-code', payload: {} })).statusCode).toBe(400);
  });

  it('protected routes require a token', async () => {
    expect((await app.inject({ method: 'GET', url: '/entities/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/entities/x/kyb', payload: { decision: 'approve' } })).statusCode).toBe(401);
  });
});

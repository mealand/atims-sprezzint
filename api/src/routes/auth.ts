import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { pool, query } from '../db/pool.js';
import { verifyPassword } from '../services/password.js';
import {
  CODE_TTL_MS, MAX_CODE_ATTEMPTS, checkCode, checkIssueRate, generateCode, hashCode, sendVerificationCode,
  type CodeDelivery, type EmailCodeRow,
} from '../services/email.js';
import {
  NEXUS_PREFIX, PASSWORD_MIN_LENGTH, parseRegistration, registrationColumns, registrationIdentifiers,
  type Role, type TrustTier,
} from '@atims/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

interface LoginBody { nexus_id?: string; email?: string; password?: string }
interface IdentityBody { nexus_id?: string; email?: string }
interface VerifyBody extends IdentityBody { code?: string }
interface ChangePasswordBody { current_password?: string; new_password?: string }

interface EntityRow {
  id: string; nexus_id: string; name: string; role: Role; status: string; trust_tier: TrustTier;
  email: string | null; email_verified_at: string | null; country: string; password_hash?: string;
}

const ENTITY_COLS = 'id, nexus_id, name, role, status, trust_tier, email, email_verified_at, country';

/** What the client may see about an account. */
function publicEntity(e: EntityRow) {
  return {
    id: e.id, nexus_id: e.nexus_id, name: e.name, role: e.role, status: e.status,
    trust_tier: e.trust_tier, email: e.email, email_verified: Boolean(e.email_verified_at), country: e.country,
  };
}

/** Which registration field an identifier kind came from, so the wizard can highlight it. */
function identifierField(kind: string): string {
  if (kind.startsWith('cac:')) return 'profile.cac_number';
  if (kind.startsWith('nepc:')) return 'profile.nepc_number';
  if (kind.startsWith('tin:')) return 'profile.tin';
  if (kind.startsWith('iso17025:')) return 'profile.iso17025_accreditation_number';
  if (kind.startsWith('staff:')) return 'profile.staff_id';
  if (kind.startsWith('import_licence:')) return 'profile.import_licence';
  return 'profile';
}

/** Find an account by email or Nexus ID. */
async function findEntity(db: Pick<pg.PoolClient, 'query'>, body: IdentityBody, lock = false): Promise<EntityRow | undefined> {
  const forUpdate = lock ? ' FOR UPDATE' : '';
  if (body.email) {
    return (await db.query<EntityRow>(
      `SELECT ${ENTITY_COLS}, password_hash FROM entities WHERE lower(email) = lower($1)${forUpdate}`, [String(body.email).trim()],
    )).rows[0];
  }
  if (body.nexus_id) {
    return (await db.query<EntityRow>(
      `SELECT ${ENTITY_COLS}, password_hash FROM entities WHERE nexus_id = upper($1)${forUpdate}`, [String(body.nexus_id).trim()],
    )).rows[0];
  }
  return undefined;
}

async function inTransaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function issueCode(db: Pick<pg.PoolClient, 'query'>, entityId: string): Promise<string> {
  const code = generateCode();
  await db.query(
    `INSERT INTO email_codes (entity_id, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`,
    [entityId, hashCode(entityId, code), CODE_TTL_MS / 1000],
  );
  return code;
}

/** Send, never throw: a provider outage must not lose the account; the user can resend. */
async function deliver(req: FastifyRequest, e: { email: string | null; name: string }, code: string): Promise<CodeDelivery & { error?: string }> {
  try {
    return await sendVerificationCode(String(e.email), e.name, code);
  } catch (err) {
    req.log.error({ err }, 'verification email failed');
    return { delivered: false, expires_in_s: CODE_TTL_MS / 1000, error: 'could not send the email; request a new code' };
  }
}

export default async function authRoutes(app: FastifyInstance) {
  /**
   * POST /auth/register: role-specific self-registration (never admin).
   * Runs the automatic checks (format, completeness, uniqueness), creates the
   * account at trust tier 'registered' and emails a 6-digit code.
   */
  app.post('/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = parseRegistration(req.body);
    if (!parsed.ok) {
      const status = parsed.code === 'ADMIN_NOT_SELF_REGISTRABLE' ? 403 : 400;
      return reply.code(status).send({ status, code: parsed.code, error: parsed.error, issues: parsed.issues });
    }
    const reg = parsed.data;
    const ids = registrationIdentifiers(reg);
    const cols = registrationColumns(reg);

    type Outcome = { conflict: { code: string; error: string; issues: Array<{ path: string; message: string }> } } | { entity: EntityRow; code: string };
    let outcome: Outcome;
    try {
      outcome = await inTransaction<Outcome>(async (db) => {
        const emailTaken = (await db.query(`SELECT 1 FROM entities WHERE lower(email) = $1`, [reg.email])).rowCount;
        if (emailTaken) {
          return { conflict: {
            code: 'EMAIL_TAKEN',
            error: 'an account with this email already exists; log in, or request a new code if you have not verified it',
            issues: [{ path: 'email', message: 'already registered' }],
          } };
        }
        if (ids.length) {
          const taken = (await db.query<{ kind: string }>(
            `SELECT kind FROM entity_identifiers WHERE (kind, value) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
            [ids.map((i) => i.kind), ids.map((i) => i.value)],
          )).rows;
          if (taken.length) {
            return { conflict: {
              code: 'IDENTIFIER_TAKEN',
              error: 'a registration number on this form is already used by another account',
              issues: taken.map((t) => ({ path: identifierField(t.kind), message: 'already registered to another account' })),
            } };
          }
        }

        const nexusId = `NX-${NEXUS_PREFIX[reg.role]}-${randomBytes(4).toString('hex').toUpperCase()}`;
        const entity = (await db.query<EntityRow>(
          `INSERT INTO entities (nexus_id, name, role, status, trust_tier, password_hash, email, phone, profile, state_province, country)
           VALUES ($1, $2, $3, 'pending', 'registered', crypt($4, gen_salt('bf', 12)), $5, $6, $7::jsonb, $8, $9)
           RETURNING ${ENTITY_COLS}`,
          [nexusId, reg.name, reg.role, reg.password, reg.email, cols.phone, JSON.stringify(reg.profile), cols.state_province, cols.country],
        )).rows[0];
        for (const i of ids) {
          await db.query(`INSERT INTO entity_identifiers (entity_id, kind, value) VALUES ($1, $2, $3)`, [entity.id, i.kind, i.value]);
        }
        const code = await issueCode(db, entity.id);
        await db.query(`INSERT INTO audit_log (actor_id, action, detail) VALUES ($1, 'entity.register', $2)`,
          [entity.id, { role: reg.role }]);
        return { entity, code };
      });
    } catch (err) {
      // A concurrent registration won the race for the same email or identifier.
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ status: 409, code: 'ALREADY_REGISTERED', error: 'this email or registration number was just registered' });
      }
      throw err;
    }

    if ('conflict' in outcome) return reply.code(409).send({ status: 409, ...outcome.conflict });
    const verification = await deliver(req, outcome.entity, outcome.code);
    reply.code(201).send({
      entity: publicEntity(outcome.entity),
      verification,
      next: 'Enter the 6-digit code sent to your email at POST /auth/verify-email.',
    });
  });

  /**
   * POST /auth/verify-email: redeem the code. Promotes the account to
   * self_verified and activates it, then returns a session token. No admin step.
   */
  app.post<{ Body: VerifyBody }>('/auth/verify-email', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = req.body ?? {};
    if ((!body.email && !body.nexus_id) || !body.code) {
      return reply.code(400).send({ status: 400, code: 'BAD_REQUEST', error: 'email (or nexus_id) and code are required' });
    }

    type Result = { status: number; body: Record<string, unknown> } | { entity: EntityRow };
    const result = await inTransaction<Result>(async (db) => {
      const entity = await findEntity(db, body, true);
      if (!entity) return { status: 400, body: { status: 400, code: 'WRONG_CODE', error: 'incorrect code' } };
      if (entity.email_verified_at) {
        return { status: 409, body: { status: 409, code: 'ALREADY_VERIFIED', error: 'email already verified; log in' } };
      }
      const row = (await db.query<EmailCodeRow & { id: string }>(
        `SELECT id, entity_id, code_hash, attempts, expires_at, consumed_at FROM email_codes
          WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [entity.id],
      )).rows[0];
      const check = checkCode(row, String(body.code));
      if (!check.ok) {
        if (check.code === 'WRONG_CODE' && row) {
          await db.query(`UPDATE email_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
          return { status: 400, body: { status: 400, code: check.code, error: check.error, attempts_left: Math.max(0, MAX_CODE_ATTEMPTS - row.attempts - 1) } };
        }
        return { status: check.status, body: { status: check.status, code: check.code, error: check.error } };
      }
      await db.query(`UPDATE email_codes SET consumed_at = now() WHERE id = $1`, [row!.id]);
      const updated = (await db.query<EntityRow>(
        `UPDATE entities
            SET email_verified_at = now(),
                trust_tier = CASE WHEN trust_tier = 'registered' THEN 'self_verified' ELSE trust_tier END,
                status     = CASE WHEN status = 'pending' THEN 'verified' ELSE status END,
                updated_at = now()
          WHERE id = $1 RETURNING ${ENTITY_COLS}`, [entity.id],
      )).rows[0];
      await db.query(`INSERT INTO audit_log (actor_id, action, detail) VALUES ($1, 'entity.email_verified', '{}')`, [entity.id]);
      return { entity: updated };
    });

    if (!('entity' in result)) return reply.code(result.status).send(result.body);
    const e = result.entity;
    if (e.status !== 'verified') {
      return reply.send({ entity: publicEntity(e), message: `email verified, but the account is ${e.status}` });
    }
    reply.send({ token: app.jwt.sign({ sub: e.id }), entity: publicEntity(e) });
  });

  /** POST /auth/resend-code: a fresh code, at most one a minute and five an hour per account. */
  app.post<{ Body: IdentityBody }>('/auth/resend-code', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = req.body ?? {};
    if (!body.email && !body.nexus_id) {
      return reply.code(400).send({ status: 400, code: 'BAD_REQUEST', error: 'email or nexus_id is required' });
    }
    const generic = { ok: true, message: 'if this account exists and is unverified, a new code has been sent' };

    type Result = { reply: Record<string, unknown>; status?: number } | { entity: EntityRow; code: string };
    const result = await inTransaction<Result>(async (db) => {
      const entity = await findEntity(db, body, true);
      if (!entity || entity.email_verified_at || !entity.email) return { reply: generic };
      const recent = (await db.query<{ created_at: Date }>(
        `SELECT created_at FROM email_codes WHERE entity_id = $1 AND created_at > now() - interval '1 hour'`, [entity.id],
      )).rows.map((r) => r.created_at);
      const rate = checkIssueRate(recent);
      if (!rate.ok) {
        return { status: 429, reply: { status: 429, code: 'RATE_LIMITED', error: 'please wait before requesting another code', retry_after_s: rate.retry_after_s } };
      }
      return { entity, code: await issueCode(db, entity.id) };
    });

    if ('reply' in result) return reply.code(result.status ?? 200).send(result.reply);
    reply.send({ ...generic, ...(await deliver(req, result.entity, result.code)) });
  });

  /** POST /auth/password: change own password. */
  app.post<{ Body: ChangePasswordBody }>('/auth/password', { onRequest: [app.authenticate] },
    async (req: FastifyRequest<{ Body: ChangePasswordBody }>, reply) => {
      const { current_password, new_password } = req.body ?? {};
      if (!current_password || !new_password) {
        return reply.code(400).send({ error: 'current_password and new_password are required' });
      }
      if (typeof new_password !== 'string' || new_password.length < PASSWORD_MIN_LENGTH) {
        return reply.code(400).send({ error: `new_password must be at least ${PASSWORD_MIN_LENGTH} characters` });
      }

      const { rows } = await query(`SELECT id, password_hash FROM entities WHERE id = $1`, [req.entity!.id]);
      const entity = rows[0];
      if (!entity || !(await verifyPassword(String(current_password), String(entity.password_hash)))) {
        return reply.code(401).send({ error: 'current password is incorrect' });
      }

      await query(`UPDATE entities SET password_hash = crypt($2, gen_salt('bf', 12)), updated_at = now() WHERE id = $1`,
        [entity.id, new_password]);
      reply.send({ ok: true, message: 'password updated' });
    },
  );

  /** POST /auth/login: by Nexus ID or email. Works for self_verified and kyb_verified accounts. */
  app.post<{ Body: LoginBody }>('/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { nexus_id, email, password } = req.body ?? {};
    if ((!nexus_id && !email) || !password) return reply.code(400).send({ error: 'nexus_id (or email) and password required' });

    const entity = await findEntity(pool, { nexus_id, email });
    if (!entity || !(await verifyPassword(String(password), String(entity.password_hash)))) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    if (entity.status !== 'verified') {
      if (entity.trust_tier === 'registered' && entity.status === 'pending' && !entity.email) {
        // Accounts created before email verification existed: an admin activates them.
        return reply.code(403).send({ status: 403, code: 'ACCOUNT_PENDING', error: 'account pending: awaiting admin verification' });
      }
      if (entity.trust_tier === 'registered' && entity.status === 'pending') {
        return reply.code(403).send({
          status: 403, code: 'EMAIL_UNVERIFIED',
          error: 'confirm your email with the 6-digit code before logging in', email: entity.email,
        });
      }
      return reply.code(403).send({ status: 403, code: 'ACCOUNT_INACTIVE', error: `account ${entity.status}` });
    }
    const token = app.jwt.sign({ sub: entity.id });
    reply.send({ token, entity: publicEntity(entity) });
  });
}

/**
 * Email: provider adapter plus the verification-code rules.
 *
 * Adapter: with RESEND_API_KEY set, mail goes out through the Resend HTTP API.
 * Without it (dev and demo only), nothing is sent: the code is logged and
 * returned to the caller as `dev_code` so the registration flow still works.
 *
 * Codes: 6 digits, stored only as an HMAC keyed with JWT_SECRET, valid for
 * 15 minutes, single use, and dead after MAX_CODE_ATTEMPTS wrong guesses.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

// No top-level import of config, pool or logger: those exit without a full env,
// and this module is unit-tested in CI without one.

export const CODE_TTL_MS = 15 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
/** Minimum gap between two codes for one account. */
export const RESEND_COOLDOWN_MS = 60 * 1000;
/** Most codes one account may be sent per hour. */
export const MAX_CODES_PER_HOUR = 5;

// ── Codes ───────────────────────────────────────────────────

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** HMAC binds the code to the account, so a leaked hash table cannot be brute-forced offline without the secret. */
export function hashCode(entityId: string, code: string, secret: string | undefined = process.env.JWT_SECRET): string {
  if (!secret) throw new Error('JWT_SECRET is required to hash email codes');
  return createHmac('sha256', secret).update(`email-code:${entityId}:${code}`).digest('hex');
}

export interface EmailCodeRow {
  entity_id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

export type CodeCheck =
  | { ok: true }
  | { ok: false; status: 400 | 410 | 429; code: 'NO_CODE' | 'CODE_USED' | 'CODE_EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'WRONG_CODE'; error: string };

/**
 * Decide whether `input` redeems `row`. Pure: the caller records the outcome
 * (consume on ok, increment attempts on WRONG_CODE).
 */
export function checkCode(row: EmailCodeRow | null | undefined, input: string, now: Date = new Date(), secret?: string): CodeCheck {
  if (!row) return { ok: false, status: 400, code: 'NO_CODE', error: 'no verification code issued; request a new one' };
  if (row.consumed_at) return { ok: false, status: 410, code: 'CODE_USED', error: 'this code has already been used; request a new one' };
  if (new Date(row.expires_at).valueOf() <= now.valueOf()) {
    return { ok: false, status: 410, code: 'CODE_EXPIRED', error: 'this code has expired; request a new one' };
  }
  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    return { ok: false, status: 429, code: 'TOO_MANY_ATTEMPTS', error: 'too many wrong attempts; request a new code' };
  }
  const clean = String(input ?? '').trim();
  const expected = Buffer.from(row.code_hash, 'hex');
  const actual = Buffer.from(hashCode(row.entity_id, clean, secret), 'hex');
  if (!/^\d{6}$/.test(clean) || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, status: 400, code: 'WRONG_CODE', error: 'incorrect code' };
  }
  return { ok: true };
}

/** Rate limit for issuing codes, from the creation times of recent codes for one account. */
export function checkIssueRate(recentCreatedAt: Array<Date | string>, now: Date = new Date()): { ok: true } | { ok: false; retry_after_s: number } {
  const times = recentCreatedAt.map((t) => new Date(t).valueOf()).sort((a, b) => b - a);
  const latest = times[0];
  if (latest !== undefined && now.valueOf() - latest < RESEND_COOLDOWN_MS) {
    return { ok: false, retry_after_s: Math.ceil((RESEND_COOLDOWN_MS - (now.valueOf() - latest)) / 1000) };
  }
  const lastHour = times.filter((t) => now.valueOf() - t < 60 * 60 * 1000);
  if (lastHour.length >= MAX_CODES_PER_HOUR) {
    const oldest = lastHour[lastHour.length - 1];
    return { ok: false, retry_after_s: Math.ceil((60 * 60 * 1000 - (now.valueOf() - oldest)) / 1000) };
  }
  return { ok: true };
}

// ── Provider adapter ───────────────────────────────────────

export interface OutboundEmail { to: string; subject: string; text: string }

export type SendResult =
  | { delivered: true; provider: 'resend' }
  | { delivered: false; provider: 'dev' };

export interface EmailProvider { send(msg: OutboundEmail): Promise<SendResult> }

export function resendProvider(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): EmailProvider {
  return {
    async send(msg) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Resend responded ${res.status}: ${body.slice(0, 200)}`);
      }
      return { delivered: true, provider: 'resend' };
    },
  };
}

export const devProvider: EmailProvider = {
  async send(msg) {
    const { logger } = await import('../utils/logger.js');
    logger.warn({ to: msg.to, subject: msg.subject }, 'email not sent (RESEND_API_KEY unset): code returned as dev_code');
    return { delivered: false, provider: 'dev' };
  },
};

export function emailProviderFromEnv(e: NodeJS.ProcessEnv = process.env): EmailProvider {
  const key = e.RESEND_API_KEY?.trim();
  if (!key) return devProvider;
  return resendProvider(key, e.EMAIL_FROM?.trim() || 'ATiMs <no-reply@sprezzint.com>');
}

let provider: EmailProvider | null = null;
function currentProvider(): EmailProvider {
  provider ??= emailProviderFromEnv();
  return provider;
}

/** Test hook. */
export function setEmailProvider(p: EmailProvider | null) { provider = p; }

export interface CodeDelivery {
  delivered: boolean;
  expires_in_s: number;
  /** Present only when no email provider is configured (dev and demo). */
  dev_code?: string;
}

/** Send a verification code. Returns `dev_code` when nothing was actually sent. */
export async function sendVerificationCode(to: string, name: string, code: string): Promise<CodeDelivery> {
  const result = await currentProvider().send({
    to,
    subject: `Your ATiMs verification code: ${code}`,
    text: `Hello ${name},\n\nYour ATiMs verification code is ${code}. It expires in 15 minutes.\n\n`
      + `If you did not create an ATiMs account, you can ignore this email.\n\nSprezz Integrated Limited`,
  });
  const out: CodeDelivery = { delivered: result.delivered, expires_in_s: CODE_TTL_MS / 1000 };
  if (!result.delivered) out.dev_code = code;
  return out;
}

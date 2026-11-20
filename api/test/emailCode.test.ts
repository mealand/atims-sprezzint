import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  CODE_TTL_MS, MAX_CODE_ATTEMPTS, checkCode, checkIssueRate, emailProviderFromEnv, generateCode, hashCode,
  resendProvider, sendVerificationCode, setEmailProvider, devProvider, type EmailCodeRow,
} from '../src/services/email.js';

const SECRET = 'test-secret-at-least-16-chars';
const ENTITY = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-11-20T10:00:00Z');

function row(code: string, over: Partial<EmailCodeRow> = {}): EmailCodeRow {
  return {
    entity_id: ENTITY,
    code_hash: hashCode(ENTITY, code, SECRET),
    attempts: 0,
    expires_at: new Date(NOW.valueOf() + CODE_TTL_MS),
    consumed_at: null,
    ...over,
  };
}

describe('email codes: generation and hashing', () => {
  it('generates 6-digit codes', () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it('hash is bound to the account and the secret, and never equals the code', () => {
    const h = hashCode(ENTITY, '123456', SECRET);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('123456');
    expect(hashCode('22222222-2222-2222-2222-222222222222', '123456', SECRET)).not.toBe(h);
    expect(hashCode(ENTITY, '123456', 'another-secret-16-chars')).not.toBe(h);
  });

  it('refuses to hash without a secret', () => {
    expect(() => hashCode(ENTITY, '123456', '')).toThrow(/JWT_SECRET/);
  });
});

describe('email codes: redemption', () => {
  it('accepts the right code within 15 minutes', () => {
    expect(checkCode(row('042137'), '042137', NOW, SECRET)).toEqual({ ok: true });
    expect(checkCode(row('042137'), ' 042137 ', NOW, SECRET)).toEqual({ ok: true });
  });

  it('rejects a wrong code', () => {
    const r = checkCode(row('042137'), '042138', NOW, SECRET);
    expect(r).toMatchObject({ ok: false, code: 'WRONG_CODE', status: 400 });
    expect(checkCode(row('042137'), 'abcdef', NOW, SECRET)).toMatchObject({ code: 'WRONG_CODE' });
    expect(checkCode(row('042137'), '', NOW, SECRET)).toMatchObject({ code: 'WRONG_CODE' });
  });

  it('rejects an expired code, even if correct', () => {
    const expired = row('042137', { expires_at: new Date(NOW.valueOf() - 1) });
    expect(checkCode(expired, '042137', NOW, SECRET)).toMatchObject({ ok: false, code: 'CODE_EXPIRED', status: 410 });
    const atExpiry = row('042137', { expires_at: NOW });
    expect(checkCode(atExpiry, '042137', NOW, SECRET)).toMatchObject({ code: 'CODE_EXPIRED' });
  });

  it('rejects reuse of a consumed code', () => {
    const used = row('042137', { consumed_at: new Date(NOW.valueOf() - 1000) });
    expect(checkCode(used, '042137', NOW, SECRET)).toMatchObject({ ok: false, code: 'CODE_USED', status: 410 });
  });

  it(`locks the code after ${MAX_CODE_ATTEMPTS} wrong attempts, even for the right code`, () => {
    expect(checkCode(row('042137', { attempts: MAX_CODE_ATTEMPTS - 1 }), '042137', NOW, SECRET)).toEqual({ ok: true });
    expect(checkCode(row('042137', { attempts: MAX_CODE_ATTEMPTS }), '042137', NOW, SECRET))
      .toMatchObject({ ok: false, code: 'TOO_MANY_ATTEMPTS', status: 429 });
  });

  it('reports a missing code', () => {
    expect(checkCode(undefined, '042137', NOW, SECRET)).toMatchObject({ ok: false, code: 'NO_CODE' });
  });

  it('a code for another account does not work', () => {
    const other = { ...row('042137'), entity_id: '22222222-2222-2222-2222-222222222222' };
    expect(checkCode(other, '042137', NOW, SECRET)).toMatchObject({ code: 'WRONG_CODE' });
  });
});

describe('email codes: issue rate limit', () => {
  const ago = (ms: number) => new Date(NOW.valueOf() - ms);

  it('allows the first code', () => {
    expect(checkIssueRate([], NOW)).toEqual({ ok: true });
  });

  it('enforces a 60 second cooldown', () => {
    expect(checkIssueRate([ago(30_000)], NOW)).toEqual({ ok: false, retry_after_s: 30 });
    expect(checkIssueRate([ago(61_000)], NOW)).toEqual({ ok: true });
  });

  it('caps codes per hour', () => {
    const five = [2, 10, 20, 30, 40].map((m) => ago(m * 60_000));
    const r = checkIssueRate(five, NOW);
    expect(r.ok).toBe(false);
    expect(checkIssueRate(five.slice(0, 4), NOW)).toEqual({ ok: true });
  });
});

describe('email adapter', () => {
  afterEach(() => setEmailProvider(null));

  it('without RESEND_API_KEY returns the code as dev_code', async () => {
    expect(emailProviderFromEnv({})).toBe(devProvider);
    expect(emailProviderFromEnv({ RESEND_API_KEY: '  ' })).toBe(devProvider);
    setEmailProvider({ send: async () => ({ delivered: false, provider: 'dev' }) });
    const d = await sendVerificationCode('a@example.com', 'Amina', '123456');
    expect(d).toEqual({ delivered: false, expires_in_s: 900, dev_code: '123456' });
  });

  it('with a provider that delivers, never exposes the code', async () => {
    setEmailProvider({ send: async () => ({ delivered: true, provider: 'resend' }) });
    const d = await sendVerificationCode('a@example.com', 'Amina', '123456');
    expect(d).toEqual({ delivered: true, expires_in_s: 900 });
    expect(JSON.stringify(d)).not.toContain('123456');
  });

  it('Resend provider posts to the Resend API with a bearer key', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }));
    const p = resendProvider('re_test_key', 'ATiMs <no-reply@example.com>', fetchMock as unknown as typeof fetch);
    await expect(p.send({ to: 'a@example.com', subject: 's', text: 't' })).resolves.toEqual({ delivered: true, provider: 'resend' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test_key');
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ['a@example.com'], from: 'ATiMs <no-reply@example.com>' });
  });

  it('Resend provider throws on an API error', async () => {
    const fetchMock = vi.fn(async () => new Response('bad key', { status: 401 }));
    const p = resendProvider('re_bad', 'x@example.com', fetchMock as unknown as typeof fetch);
    await expect(p.send({ to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow(/401/);
  });
});

import { useEffect, useRef, useState } from 'react';
import { MailCheck, RotateCw, FlaskConical } from 'lucide-react';
import { api, setToken } from '../../lib/api';
import { Button, Field, Input } from '../../components/ui';
import { FormAlert } from './AuthShell';

export interface Verification { delivered?: boolean; expires_in_s?: number; dev_code?: string; error?: string }

interface ApiError { message: string; data?: { code?: string; error?: string; attempts_left?: number; retry_after_s?: number } }

const RESEND_COOLDOWN_S = 60;

/**
 * Enter the 6-digit email code (POST /auth/verify-email). On success the API
 * returns a session token: we store it and reload into the role dashboard, so
 * the auth context picks up the new account from GET /entities/me.
 *
 * When the API has no email provider configured it returns the code as
 * `dev_code`; we show it so demos and reviewers are never stuck.
 */
export function EmailCodeStep({ email, nexusId, verification }:
  { email: string; nexusId?: string; verification?: Verification | null }) {
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(verification?.dev_code ?? null);
  const [error, setError] = useState<string | null>(verification?.error ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(verification ? RESEND_COOLDOWN_S : 0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const identity = email ? { email } : { nexus_id: nexusId };

  async function verify(e?: React.FormEvent, value = code) {
    e?.preventDefault();
    if (!/^\d{6}$/.test(value)) { setError('Enter the 6-digit code.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const d = await api<{ token?: string; message?: string }>('/auth/verify-email', { method: 'POST', body: { ...identity, code: value } });
      if (!d.token) { setError(d.message ?? 'Email confirmed, but this account cannot sign in yet.'); setBusy(false); return; }
      setToken(d.token);
      // Full navigation so the auth context loads the new account and its role dashboard.
      window.location.replace('/?welcome=1');
    } catch (err) {
      const { message, data } = err as ApiError;
      if (data?.code === 'ALREADY_VERIFIED') setError('This email is already confirmed. Sign in with your Nexus ID and password.');
      else if (data?.code === 'WRONG_CODE' && typeof data.attempts_left === 'number') {
        setError(`That code is not right. ${data.attempts_left} ${data.attempts_left === 1 ? 'attempt' : 'attempts'} left.`);
      } else setError(humanise(message));
      setBusy(false);
    }
  }

  async function resend() {
    setResending(true); setError(null); setNotice(null);
    try {
      const d = await api<Verification & { message?: string }>('/auth/resend-code', { method: 'POST', body: identity });
      setDevCode(d.dev_code ?? null);
      setCode('');
      setNotice(d.delivered ? `A new code is on its way to ${email || 'your email'}.` : 'A new code was issued.');
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      const { message, data } = err as ApiError;
      if (data?.retry_after_s) { setCooldown(data.retry_after_s); setError(`Please wait ${data.retry_after_s} seconds before asking for another code.`); }
      else setError(humanise(message));
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary" aria-hidden>
          <MailCheck className="size-5.5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold text-ink">Check your email</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {email
              ? <>We sent a 6-digit code to <strong className="break-all text-ink">{email}</strong>. It expires in 15 minutes.</>
              : <>Enter the 6-digit code from your email. It expires in 15 minutes.</>}
          </p>
        </div>
      </div>

      {devCode && (
        <div role="status" className="rounded-xl border border-brand-yellow/50 bg-brand-yellow-soft p-4 text-brand-yellow-ink">
          <p className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="size-4" aria-hidden /> Demo mode</p>
          <p className="mt-1 text-sm">Email sending is not configured on this server, so your code is shown here:</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="rounded-lg bg-surface px-3 py-1.5 font-mono text-2xl font-bold tracking-[0.3em] text-ink" data-testid="dev-code">{devCode}</span>
            <Button size="sm" variant="outline" onClick={() => { setCode(devCode); void verify(undefined, devCode); }}>
              Use this code
            </Button>
          </div>
        </div>
      )}

      {error && <FormAlert>{error}</FormAlert>}
      {notice && !error && <FormAlert tone="success">{notice}</FormAlert>}

      <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
        <Field label="Verification code" required>
          <Input ref={inputRef} value={code} name="code"
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="000000"
            className="text-center font-mono text-2xl tracking-[0.4em]" />
        </Field>
        <Button type="submit" size="lg" block loading={busy} disabled={code.length !== 6}>
          {busy ? 'Confirming' : 'Confirm and continue'}
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
        <span>Did not get it? Check spam, or</span>
        <Button variant="ghost" size="sm" onClick={resend} loading={resending} disabled={cooldown > 0}>
          <RotateCw aria-hidden /> {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send a new code'}
        </Button>
      </div>
    </div>
  );
}

function humanise(message: string): string {
  if (!message || message === 'Failed to fetch') return 'Could not reach the server. Check your connection and try again.';
  return message.charAt(0).toUpperCase() + message.slice(1);
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, IdCard, KeyRound, ShieldCheck, Link2, QrCode } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { BrandLockup, Button, Field, Input } from '../../components/ui';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [nexusId, setNexusId] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(nexusId.trim().toUpperCase(), password);
      nav('/');
    } catch (err) {
      setError((err as Error).message || 'Sign in failed. Check your Nexus ID and password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main data-ui className="grid min-h-dvh bg-canvas lg:grid-cols-2">
      {/* Brand panel (desktop) */}
      <section aria-hidden className="relative hidden overflow-hidden bg-primary text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute -right-24 -top-24 size-96 rotate-45 rounded-[4rem] bg-white/10" />
        <div className="absolute -bottom-32 -left-20 size-80 rotate-45 rounded-[3.5rem] bg-black/10" />
        <BrandLockup inverse className="relative" />
        <div className="relative max-w-md">
          <h2 className="font-display text-4xl font-extrabold leading-tight tracking-tight">
            Every handover signed. Every batch provable.
          </h2>
          <ul className="mt-8 flex flex-col gap-4 text-white/90">
            <li className="flex items-center gap-3"><ShieldCheck className="size-5 shrink-0" /> Your signing key stays on this device</li>
            <li className="flex items-center gap-3"><Link2 className="size-5 shrink-0" /> Records join an append-only, hash-chained ledger</li>
            <li className="flex items-center gap-3"><QrCode className="size-5 shrink-0" /> Buyers verify a batch from its QR code</li>
          </ul>
        </div>
        <p className="relative text-sm text-white/75">Sprezz Integrated Limited, Abuja, Nigeria</p>
      </section>

      {/* Form */}
      <section className="flex flex-col px-4 py-6 sm:px-8 lg:px-12">
        <div className="flex items-center justify-between">
          <Link to="/" className="rounded-lg lg:hidden" aria-label="ATiMs home"><BrandLockup /></Link>
          <Link to="/" className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-ink-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Home
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">Welcome back</h1>
          <p className="mt-2 text-ink-muted">Sign in with the Nexus ID you received when you registered.</p>

          {error && (
            <div role="alert" className="mt-6 rounded-lg border border-primary/20 bg-primary-soft px-4 py-3 text-sm font-medium text-primary-dark">
              {error}
            </div>
          )}

          <form onSubmit={submit} className="mt-6 flex flex-col gap-5" noValidate={false}>
            <Field label="Nexus ID" hint="For example NX-FR-1A2B3C" required>
              <Input value={nexusId} onChange={(e) => setNexusId(e.target.value)} name="username"
                autoComplete="username" autoCapitalize="characters" spellCheck={false}
                leading={<IdCard />} className="font-mono uppercase" required />
            </Field>

            <Field label="Password" required>
              <Input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                name="password" autoComplete="current-password" leading={<KeyRound />} required
                trailing={
                  <button type="button" onClick={() => setShowPw((s) => !s)}
                    aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}
                    className="mr-1 inline-flex size-10 min-h-0 items-center justify-center rounded-md bg-transparent p-0 text-ink-muted hover:bg-surface-muted hover:text-ink">
                    {showPw ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
                  </button>
                } />
            </Field>

            <Button type="submit" size="lg" block loading={submitting}>
              {submitting ? 'Signing in' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-8 text-center text-sm text-ink-muted">
            New to ATiMs?{' '}
            <Link to="/register" className="font-semibold text-primary underline-offset-4 hover:underline">Create an account</Link>
          </p>
          <p className="mt-2 text-center text-sm text-ink-muted">
            Checking a shipment?{' '}
            <Link to="/trace" className="font-semibold text-primary underline-offset-4 hover:underline">Trace a batch</Link>
          </p>
        </div>
      </section>
    </main>
  );
}

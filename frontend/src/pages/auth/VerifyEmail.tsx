import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { Button, Card, CardContent, Field, Input } from '../../components/ui';
import { AuthShell } from './AuthShell';
import { EmailCodeStep } from './EmailCodeStep';

function pendingEmail(): string {
  try { return (JSON.parse(sessionStorage.getItem('atims_pending_email') ?? '{}') as { email?: string }).email ?? ''; }
  catch { return ''; }
}

/**
 * /verify-email: finish a registration whose code step was left (tab closed,
 * phone locked). Asks for the email, then reuses the wizard's code step.
 */
export default function VerifyEmail() {
  const { me, loading } = useAuth();
  const [params] = useSearchParams();
  const initial = params.get('email') ?? pendingEmail();
  const [email, setEmail] = useState(initial);
  const [confirmed, setConfirmed] = useState(Boolean(initial));

  if (!loading && me) return <Navigate to="/" replace />;

  return (
    <AuthShell back={{ to: '/register', label: 'Register' }}>
      <h1 className="mb-6 font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Confirm your email</h1>
      <Card>
        <CardContent className="flex flex-col gap-5">
          {confirmed && email ? (
            <>
              <EmailCodeStep key={email} email={email} />
              <Button variant="link" size="sm" className="self-start" onClick={() => setConfirmed(false)}>Use a different email</Button>
            </>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (email.includes('@')) setConfirmed(true); }}>
              <p className="text-sm text-ink-muted">Enter the email you registered with. You can then type your code, or ask for a new one.</p>
              <Field label="Email" required>
                <Input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} />
              </Field>
              <Button type="submit" size="lg" block>Continue</Button>
            </form>
          )}
        </CardContent>
      </Card>
      <p className="mt-6 text-center text-sm text-ink-muted">
        Already confirmed? <Link to="/login" className="font-semibold text-primary underline-offset-4 hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}

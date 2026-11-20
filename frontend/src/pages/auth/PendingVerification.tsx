import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { Button } from '../../components/ui';
import { AuthShell } from './AuthShell';

/** Shown for older accounts that still wait for an admin, or when an account is not active. */
export default function PendingVerification() {
  return (
    <AuthShell>
      <div className="rounded-xl border border-line bg-surface p-6 text-center shadow-card">
        <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-brand-yellow-soft text-brand-yellow-ink" aria-hidden>
          <Clock className="size-6" />
        </span>
        <h1 className="font-display text-xl font-bold text-ink">Account not active yet</h1>
        <p className="mt-2 text-sm text-ink-muted">
          New accounts become active as soon as the email code is confirmed. If you registered recently, enter your code.
          Accounts created before email codes existed are activated by a Sprezz administrator.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild><Link to="/verify-email">Enter my code</Link></Button>
          <Button asChild variant="outline"><Link to="/trace">Trace a batch instead</Link></Button>
        </div>
      </div>
    </AuthShell>
  );
}

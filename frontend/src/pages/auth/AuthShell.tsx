import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { BrandLockup, cn } from '../../components/ui';

/**
 * Page frame for signed-out flows (registration, email code). Mobile first:
 * a slim brand bar, then one centred column. Matches the Login page styling.
 */
export function AuthShell({ children, wide, back = { to: '/', label: 'Home' } }:
  { children: ReactNode; wide?: boolean; back?: { to: string; label: string } }) {
  return (
    <main data-ui className="min-h-dvh bg-canvas">
      <div className="flex items-center justify-between px-4 py-3 sm:px-8">
        <Link to="/" className="rounded-lg" aria-label="ATiMs home"><BrandLockup /></Link>
        <Link to={back.to} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> {back.label}
        </Link>
      </div>
      <div className={cn('mx-auto w-full px-4 pb-16 pt-2 sm:px-6 sm:pt-6', wide ? 'max-w-3xl' : 'max-w-lg')}>
        {children}
      </div>
    </main>
  );
}

/** Inline alert used by the auth forms. */
export function FormAlert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' | 'success' }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-lg border px-4 py-3 text-sm font-medium',
        tone === 'error' && 'border-primary/20 bg-primary-soft text-primary-dark',
        tone === 'info' && 'border-brand-blue/30 bg-brand-blue-soft text-brand-blue-ink',
        tone === 'success' && 'border-brand-green/30 bg-brand-green-soft text-brand-green-ink')}>
      {children}
    </div>
  );
}

/** Kept for any page still importing the old card wrapper. */
export function AuthCard({ children, error }: { children: ReactNode; error?: string | null }) {
  return (
    <AuthShell>
      <div className="rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
        {error && <div className="mb-4"><FormAlert>{error}</FormAlert></div>}
        {children}
      </div>
    </AuthShell>
  );
}

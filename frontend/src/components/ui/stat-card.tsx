import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';

export interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Any CSS colour (e.g. 'var(--brand-green)'); used for the accent bar and icon. */
  accent?: string;
  icon?: LucideIcon;
  hint?: ReactNode;
  className?: string;
}

export function StatCard({ label, value, accent = 'var(--brand-blue)', icon: Icon, hint, className }: StatCardProps) {
  return (
    <div data-ui className={cn('relative overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-card', className)}>
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{label}</p>
        {Icon && <Icon className="size-4.5 shrink-0" style={{ color: accent }} aria-hidden />}
      </div>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink sm:text-3xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

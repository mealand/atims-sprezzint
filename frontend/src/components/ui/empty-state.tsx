import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { cn } from './cn';

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }:
  { icon?: LucideIcon; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div data-ui className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center', className)}>
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary" aria-hidden>
        <Icon className="size-6" />
      </span>
      <h3 className="font-display text-base font-bold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

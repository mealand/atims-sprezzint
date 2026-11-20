import { Check } from 'lucide-react';
import { cn } from './cn';

export interface Step { label: string; description?: string }

/**
 * Progress through a multi-step flow. `current` is the zero-based active step.
 * Phones show "Step 2 of 4" plus the active label; wider screens show every step.
 */
export function Stepper({ steps, current, className }: { steps: Step[]; current: number; className?: string }) {
  return (
    <nav data-ui aria-label="Progress" className={className}>
      <p className="mb-2 text-sm text-ink-muted sm:hidden">
        Step {Math.min(current + 1, steps.length)} of {steps.length}:{' '}
        <span className="font-semibold text-ink">{steps[current]?.label}</span>
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted sm:hidden" aria-hidden>
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
      </div>
      <ol className="hidden items-start sm:flex">
        {steps.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'upcoming';
          return (
            <li key={s.label} className="relative flex flex-1 flex-col items-center text-center"
              aria-current={state === 'current' ? 'step' : undefined}>
              {i > 0 && (
                <span aria-hidden className={cn('absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2',
                  i <= current ? 'bg-primary' : 'bg-line')} />
              )}
              <span className={cn(
                'relative z-10 flex size-8 items-center justify-center rounded-full border-2 text-sm font-bold',
                state === 'done' && 'border-primary bg-primary text-primary-fg',
                state === 'current' && 'border-primary bg-surface text-primary',
                state === 'upcoming' && 'border-line-strong bg-surface text-ink-subtle',
              )}>
                {state === 'done' ? <Check className="size-4" aria-hidden /> : i + 1}
              </span>
              <span className={cn('mt-2 px-1 text-xs font-semibold', state === 'upcoming' ? 'text-ink-muted' : 'text-ink')}>
                {s.label}
                <span className="sr-only">{state === 'done' ? ' (completed)' : state === 'current' ? ' (current)' : ''}</span>
              </span>
              {s.description && <span className="mt-0.5 px-1 text-[11px] text-ink-muted">{s.description}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

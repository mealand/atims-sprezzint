import { cn } from './cn';

/**
 * Sprezz mark: crimson diamond with the four coloured arrows of the logo,
 * simplified to corner ticks. Decorative unless `title` is given.
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn('size-8', className)} role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true} aria-label={title}>
      <rect x="8" y="8" width="24" height="24" rx="4" transform="rotate(45 20 20)" fill="#A81D1D" />
      <path d="M20 3 L24 7 M20 3 L16 7" stroke="#4CAF50" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M37 20 L33 24 M37 20 L33 16" stroke="#2392DF" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M20 37 L24 33 M20 37 L16 33" stroke="#F5C51D" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M3 20 L7 24 M3 20 L7 16" stroke="#A349A4" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M14 21.5 L18.5 26 L26.5 15" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Mark plus "ATiMs" wordmark. */
export function BrandLockup({ className, inverse, sub = true }: { className?: string; inverse?: boolean; sub?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      {inverse
        ? <span className="flex size-10 items-center justify-center rounded-xl bg-white"><BrandMark /></span>
        : <BrandMark />}
      <span className="flex flex-col leading-none">
        <span className={cn('font-display text-lg font-extrabold tracking-tight', inverse ? 'text-white' : 'text-ink')}>ATiMs</span>
        {sub && <span className={cn('mt-0.5 text-[11px] font-medium', inverse ? 'text-white/80' : 'text-ink-muted')}>by Sprezz Integrated</span>}
      </span>
    </span>
  );
}

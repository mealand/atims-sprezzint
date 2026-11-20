import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

/** Shared look for text-like controls. 16px text avoids iOS zoom on focus. */
export const fieldBase =
  'block w-full min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-base text-ink ' +
  'placeholder:text-ink-subtle transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary focus-visible:border-primary ' +
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 ' +
  'aria-invalid:border-primary aria-invalid:bg-primary-soft/40';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Icon or text shown inside the field on the left. */
  leading?: ReactNode;
  /** Element (e.g. an icon button) shown inside the field on the right. */
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, leading, trailing, ...props }, ref) => {
  if (!leading && !trailing) return <input ref={ref} className={cn(fieldBase, className)} {...props} />;
  return (
    <div className="relative">
      {leading && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-subtle [&_svg]:size-4.5" aria-hidden>
          {leading}
        </span>
      )}
      <input ref={ref} className={cn(fieldBase, leading && 'pl-10', trailing && 'pr-12', className)} {...props} />
      {trailing && <span className="absolute inset-y-0 right-0 flex items-center">{trailing}</span>}
    </div>
  );
});
Input.displayName = 'Input';

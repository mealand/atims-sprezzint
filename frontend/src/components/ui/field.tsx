import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn';
import { Label } from './label';

export interface FieldProps {
  label: ReactNode;
  /** A single form control (Input, Select, Textarea...). It receives id and aria wiring. */
  children: ReactElement;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
}

/** Label + control + hint + error, with id, aria-describedby and aria-invalid wired up. */
export function Field({ label, children, hint, error, required, className, hideLabel }: FieldProps) {
  const auto = useId();
  const childProps = isValidElement(children) ? (children.props as Record<string, unknown>) : {};
  const id = (childProps.id as string | undefined) ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [childProps['aria-describedby'] as string | undefined, hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div data-ui className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} required={required} className={hideLabel ? 'sr-only' : undefined}>{label}</Label>
      {cloneElement(children, {
        id,
        required: required ?? childProps.required,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : childProps['aria-invalid'],
      } as Record<string, unknown>)}
      {hint && !error && <p id={hintId} className="text-xs text-ink-muted">{hint}</p>}
      {hint && error && <p id={hintId} className="sr-only">{hint}</p>}
      {error && <p id={errorId} className="text-xs font-medium text-primary-dark">{error}</p>}
    </div>
  );
}

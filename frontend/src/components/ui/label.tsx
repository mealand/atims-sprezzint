import { forwardRef, type LabelHTMLAttributes } from 'react';
import { cn } from './cn';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** Appends a visual asterisk; the field itself should carry `required`. */
  required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(({ className, required, children, ...props }, ref) => (
  <label ref={ref} className={cn('text-sm font-medium text-ink', className)} {...props}>
    {children}
    {required && <span className="ml-0.5 text-primary" aria-hidden>*</span>}
  </label>
));
Label.displayName = 'Label';

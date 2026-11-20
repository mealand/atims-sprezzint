import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';
import { fieldBase } from './input';

export interface SelectOption { value: string; label: string; disabled?: boolean }

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Convenience: render these options (children are still rendered after them). */
  options?: SelectOption[];
  /** Adds a disabled empty first option. */
  placeholder?: string;
}

/**
 * Native <select> with brand styling. Native keeps the platform picker on
 * phones, which is the most accessible option for touch and screen readers.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, placeholder, children, ...props }, ref) => (
    <div className="relative">
      <select ref={ref} className={cn(fieldBase, 'appearance-none pr-10', className)} {...props}>
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options?.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
    </div>
  ),
);
Select.displayName = 'Select';

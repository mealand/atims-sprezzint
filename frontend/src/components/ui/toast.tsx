import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { CircleCheck as CheckCircle2, TriangleExclamationPoint as AlertTriangle, Info, X } from 'lucide-react';
import { cn } from './cn';

type ToastVariant = 'success' | 'error' | 'info';
export interface ToastInput { title: string; description?: string; variant?: ToastVariant; duration?: number }
interface ToastItem extends ToastInput { id: number }

const ToastCtx = createContext<((t: ToastInput) => void) | null>(null);

const ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info } as const;
const ACCENT = { success: 'text-brand-green-ink', error: 'text-primary', info: 'text-brand-blue-ink' } as const;

/**
 * Radix toasts announced through an aria-live region. Mount once near the
 * root (the app shell already does); call `useToast()(...)` anywhere below it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: ToastInput) => setItems((xs) => [...xs, { ...t, id: Date.now() + Math.random() }]), []);
  const value = useMemo(() => push, [push]);

  return (
    <ToastCtx.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="down" duration={5000}>
        {children}
        {items.map(({ id, title, description, variant = 'info', duration }) => {
          const Icon = ICONS[variant];
          return (
            <ToastPrimitive.Root key={id} duration={duration} type={variant === 'error' ? 'foreground' : 'background'}
              onOpenChange={(open) => { if (!open) setItems((xs) => xs.filter((x) => x.id !== id)); }}
              className="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-raised data-[state=open]:animate-slide-up data-[swipe=end]:opacity-0">
              <Icon className={cn('mt-0.5 size-5 shrink-0', ACCENT[variant])} aria-hidden />
              <div className="min-w-0 flex-1">
                <ToastPrimitive.Title className="text-sm font-semibold text-ink">{title}</ToastPrimitive.Title>
                {description && <ToastPrimitive.Description className="mt-0.5 text-sm text-ink-muted">{description}</ToastPrimitive.Description>}
              </div>
              <ToastPrimitive.Close aria-label="Dismiss"
                className="-m-1 inline-flex size-8 min-h-0 items-center justify-center rounded-full bg-transparent p-0 text-ink-muted hover:bg-surface-muted">
                <X className="size-4" aria-hidden />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport
          className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] mx-auto flex w-full max-w-md flex-col gap-2 px-4 outline-none lg:bottom-6 lg:right-6 lg:left-auto lg:mx-0" />
      </ToastPrimitive.Provider>
    </ToastCtx.Provider>
  );
}

/** Returns a function that shows a toast. Safe (no-op) outside a provider. */
export function useToast() {
  const push = useContext(ToastCtx);
  return push ?? ((t: ToastInput) => { console.warn('useToast called outside <ToastProvider>:', t.title); });
}

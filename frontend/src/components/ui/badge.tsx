import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { BadgeCheck, CircleDashed, MailCheck } from 'lucide-react';
import { cn } from './cn';
import { roleMeta } from './roles';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-semibold leading-none [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral: 'border-line bg-surface-muted text-ink-muted',
        primary: 'border-primary/20 bg-primary-soft text-primary-dark',
        success: 'border-brand-green/30 bg-brand-green-soft text-brand-green-ink',
        warning: 'border-brand-yellow/50 bg-brand-yellow-soft text-brand-yellow-ink',
        info: 'border-brand-blue/30 bg-brand-blue-soft text-brand-blue-ink',
        purple: 'border-brand-purple/30 bg-brand-purple-soft text-brand-purple-ink',
        solid: 'border-primary bg-primary text-primary-fg',
        outline: 'border-line-strong bg-transparent text-ink',
      },
      size: { sm: 'px-2 py-1 text-[11px]', md: 'px-2.5 py-1 text-xs' },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

/* ── Role badge ─────────────────────────────────────────────────────────── */

export function RoleBadge({ role, size, className, showIcon = true }:
  { role: string; size?: 'sm' | 'md'; className?: string; showIcon?: boolean }) {
  const m = roleMeta(role);
  const Icon = m.icon;
  return (
    <Badge size={size} variant="outline" className={cn('bg-surface', className)}>
      {showIcon
        ? <Icon style={{ color: m.color }} aria-hidden />
        : <span className="size-2 rounded-full" style={{ background: m.color }} aria-hidden />}
      {m.label}
    </Badge>
  );
}

/* ── Trust badge ────────────────────────────────────────────────────────── */

export type TrustTier = 'registered' | 'self_verified' | 'kyb_verified';

export const TRUST_META: Record<TrustTier, { label: string; description: string; variant: 'neutral' | 'info' | 'success'; icon: typeof BadgeCheck }> = {
  registered:    { label: 'Registered',    variant: 'neutral', icon: CircleDashed, description: 'Account created. Email not yet confirmed.' },
  self_verified: { label: 'Self-verified', variant: 'info',    icon: MailCheck,    description: 'Email confirmed and automatic checks passed.' },
  kyb_verified:  { label: 'KYB verified',  variant: 'success', icon: BadgeCheck,   description: 'Business identity verified by an admin or inspector.' },
};

/**
 * Trust tier of an entity. Uses `trust_tier` when the API sends it (T1);
 * otherwise maps the older `status`: verified to kyb_verified, else registered.
 */
export function trustTierOf(entity: { status?: string; trust_tier?: string } | null | undefined): TrustTier {
  const t = entity?.trust_tier;
  if (t === 'registered' || t === 'self_verified' || t === 'kyb_verified') return t;
  return entity?.status === 'verified' ? 'kyb_verified' : 'registered';
}

export function TrustBadge({ tier, size, className, compact }:
  { tier: TrustTier; size?: 'sm' | 'md'; className?: string; /** Icon only, label kept for screen readers. */ compact?: boolean }) {
  const m = TRUST_META[tier];
  const Icon = m.icon;
  return (
    <Badge variant={m.variant} size={size} className={cn(compact && 'px-1.5', className)} title={m.description}>
      <Icon aria-hidden />
      <span className={compact ? 'sr-only' : undefined}>{m.label}</span>
    </Badge>
  );
}

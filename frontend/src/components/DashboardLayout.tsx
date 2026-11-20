import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CirclePlus as PlusCircle, ScanLine, QrCode, ShieldCheck, Settings as SettingsIcon, LogOut,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import {
  BrandLockup, BrandMark, Button, RoleBadge, TrustBadge, ToastProvider, cn, roleMeta, trustTierOf,
} from './ui';

export { StatCard } from './ui/stat-card';

/* ── Role-aware navigation ──────────────────────────────────────────────── */

interface NavItem {
  to: string;
  label: string;
  /** Shorter label for the phone bottom bar. */
  short?: string;
  icon: LucideIcon;
  /** Roles that see the item; omitted means everyone signed in. Mirrors route guards in main.tsx. */
  roles?: string[];
  /** Show in the phone bottom bar (max five). Others stay in the desktop sidebar. */
  mobile: boolean;
  end?: boolean;
}

const HOLDERS = ['farmer', 'aggregator', 'processor', 'exporter', 'lab', 'admin'];
const SETTINGS_ROLES = ['farmer', 'aggregator', 'processor', 'exporter', 'lab', 'inspector', 'regulator', 'admin'];

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: LayoutDashboard, mobile: true, end: true },
  { to: '/create-batch', label: 'New batch', short: 'New', icon: PlusCircle, roles: ['farmer'], mobile: true },
  { to: '/handover/accept', label: 'Accept handover', short: 'Handover', icon: ScanLine, roles: HOLDERS, mobile: true },
  { to: '/trace', label: 'Public trace', short: 'Trace', icon: QrCode, mobile: true },
  { to: '/verify', label: 'Verify a chain', short: 'Verify', icon: ShieldCheck, mobile: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, roles: SETTINGS_ROLES, mobile: true },
];

export function navItemsFor(role: string | undefined): NavItem[] {
  return NAV.filter((n) => !n.roles || (role && n.roles.includes(role)));
}

/* ── Shell ──────────────────────────────────────────────────────────────── */

export interface DashboardLayoutProps {
  title: string;
  children: ReactNode;
  /** Page-level actions (links or buttons), shown beside the title. */
  actions?: ReactNode;
  /** Optional line under the title. */
  description?: ReactNode;
  /**
   * Skip the legacy typography wrapper. Pages built only from components/ui
   * should pass `bare` so browser-default heading and paragraph margins do not apply.
   */
  bare?: boolean;
}

/**
 * App shell: sticky header with role and trust badges, a sidebar from `lg`
 * up and a bottom tab bar on phones and tablets.
 */
export default function DashboardLayout({ title, children, actions, description, bare }: DashboardLayoutProps) {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const role = roleMeta(me?.role);
  const tier = trustTierOf(me as { status?: string; trust_tier?: string } | null);
  const items = navItemsFor(me?.role);
  const mobileItems = items.filter((i) => i.mobile).slice(0, 5);

  function signOut() {
    logout();
    nav('/login');
  }

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-canvas">
        <a href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-primary focus:shadow-raised">
          Skip to content
        </a>

        {/* Header */}
        <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
          <div className="flex h-14 items-center gap-3 px-4 lg:h-16 lg:px-6">
            <Link to="/" className="shrink-0 rounded-lg" aria-label="ATiMs dashboard">
              <span className="lg:hidden"><BrandMark /></span>
              <span className="hidden lg:inline-flex"><BrandLockup /></span>
            </Link>

            {me && (
              <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
                <div className="hidden min-w-0 text-right sm:block">
                  <p className="truncate text-sm font-semibold text-ink">{me.name}</p>
                  <p className="font-mono text-[11px] text-ink-muted">{me.nexus_id}</p>
                </div>
                <div className="flex items-center gap-1.5" aria-label="Your account">
                  <RoleBadge role={me.role} size="sm" />
                  <TrustBadge tier={tier} size="sm" className="hidden sm:inline-flex" />
                  <TrustBadge tier={tier} size="sm" compact className="sm:hidden" />
                </div>
                <Button variant="ghost" size="icon" onClick={signOut} aria-label="Log out" className="lg:hidden">
                  <LogOut aria-hidden />
                </Button>
                <Button variant="outline" size="sm" onClick={signOut} className="hidden lg:inline-flex">
                  <LogOut aria-hidden /> Log out
                </Button>
              </div>
            )}
          </div>
          <div aria-hidden className="h-0.5" style={{ background: role.color }} />
        </header>

        <div className="lg:flex">
          {/* Desktop sidebar */}
          {me && (
            <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
              <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
                <ul className="flex flex-col gap-0.5">
                  {items.map((it) => (
                    <li key={it.to}>
                      <NavLink to={it.to} end={it.end}
                        className={({ isActive }) => cn(
                          'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                          isActive ? 'bg-primary-soft text-primary-dark' : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                        )}>
                        <it.icon className="size-5 shrink-0" aria-hidden />
                        {it.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="m-3 rounded-xl border border-line bg-canvas p-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-9 items-center justify-center rounded-full text-white" style={{ background: role.color }} aria-hidden>
                    <role.icon className="size-4.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{me.name}</p>
                    <p className="text-xs text-ink-muted">{role.label}</p>
                  </div>
                </div>
                <div className="mt-2"><TrustBadge tier={tier} size="sm" /></div>
              </div>
            </aside>
          )}

          {/* Content */}
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 pb-28 pt-5 outline-none sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
            <div className="mx-auto w-full max-w-6xl">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
                  {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
                </div>
                {actions && (
                  <div className={cn(
                    'flex flex-wrap gap-2',
                    // Legacy pages pass bare <a> links: give them button styling.
                    '[&>a]:inline-flex [&>a]:min-h-10 [&>a]:items-center [&>a]:rounded-lg [&>a]:border [&>a]:border-line-strong',
                    '[&>a]:bg-surface [&>a]:px-3.5 [&>a]:text-sm [&>a]:font-semibold [&>a]:text-ink [&>a]:no-underline [&>a:hover]:bg-surface-muted',
                    '[&>a:first-child]:border-primary [&>a:first-child]:bg-primary [&>a:first-child]:text-primary-fg [&>a:first-child:hover]:bg-primary-hover',
                  )}>
                    {actions}
                  </div>
                )}
              </div>
              {bare ? children : <div className="legacy-content">{children}</div>}
            </div>
          </main>
        </div>

        {/* Phone and tablet bottom navigation */}
        {me && (
          <nav aria-label="Main"
            className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
            <ul className="mx-auto flex max-w-xl">
              {mobileItems.map((it) => (
                <li key={it.to} className="flex-1">
                  <NavLink to={it.to} end={it.end}
                    className={({ isActive }) => cn(
                      'relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold transition-colors',
                      isActive ? 'text-primary' : 'text-ink-muted hover:text-ink',
                    )}>
                    {({ isActive }) => (
                      <>
                        {isActive && <span aria-hidden className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-primary" />}
                        <it.icon className="size-5.5" aria-hidden strokeWidth={isActive ? 2.4 : 2} />
                        <span>{it.short ?? it.label}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </ToastProvider>
  );
}

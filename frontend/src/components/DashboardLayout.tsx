import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { brand } from '../lib/brand';
import { ROLE_LABELS } from '@atims/shared';

/** Shared layout: crimson top bar, role-colored sidebar block, logout. */
export default function DashboardLayout({ title, children, actions }:
  { title: string; children: ReactNode; actions?: ReactNode }) {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const roleColor = me ? brand.roleColors[me.role] : brand.colors.primary;

  return (
    <div className="dash">
      <header style={{ background: brand.colors.primary, color: '#fff' }}>
        <Link to="/" className="dash-brand">ATiMs</Link>
        <span className="dash-company">Sprezz Integrated Limited</span>
        {actions && <nav className="dash-actions">{actions}</nav>}
        <button onClick={() => { logout(); nav('/login'); }} className="dash-logout">Log out</button>
      </header>
      <div className="dash-body">
        <aside className="dash-side" style={{ background: roleColor, color: '#fff' }}>
          <strong>{me?.name}</strong>
          <span>{me?.nexus_id}</span>
          <em>{me ? ROLE_LABELS[me.role] : ''}</em>
          {me && (
            <nav className="dash-nav" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14, fontSize: '0.9rem' }}>
              <Link to="/" style={{ color: '#fff' }}>Dashboard</Link>
              {me.role === 'farmer' && <Link to="/create-batch" style={{ color: '#fff' }}>Create batch</Link>}
              {['farmer','aggregator','processor','exporter','lab','admin'].includes(me.role)
                && <Link to="/handover/accept" style={{ color: '#fff' }}>Accept handover</Link>}
              <Link to="/settings" style={{ color: '#fff' }}>Settings</Link>
            </nav>
          )}
        </aside>
        <main className="dash-main">
          <h2>{title}</h2>
          {children}
        </main>
      </div>
    </div>
  );
}

export function StatCard({ label, value, accent = 'var(--brand-blue)' }:
  { label: string; value: string | number; accent?: string }) {
  return (
    <div className="stat card" style={{ borderLeft: `5px solid ${accent}` }}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

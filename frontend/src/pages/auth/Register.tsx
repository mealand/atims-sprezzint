import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { ROLE_LABELS } from '@atims/shared';

const ROLES = ['farmer', 'aggregator', 'processor', 'exporter', 'lab', 'inspector'];

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', role: 'farmer', password: '', country: 'NG' });
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register(form);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthCard>
        <h2>Registered</h2>
        <p style={{ color: 'var(--brand-yellow)' }}>Awaiting admin verification before you can sign batches.</p>
        <Link to="/login">Go to login</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard error={error}>
      <h2>Create your ATiMs entity</h2>
      <form onSubmit={submit}>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Entity / Personal name" required />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r as keyof typeof ROLE_LABELS]}</option>)}
        </select>
        <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder="Password" required minLength={8} />
        <button className="atims-primary" disabled={submitting}>{submitting ? 'Registering…' : 'Register'}</button>
      </form>
      <p className="muted">Already registered? <Link to="/login">Login</Link></p>
    </AuthCard>
  );
}

export function AuthCard({ children, error }: { children: React.ReactNode; error?: string | null }) {
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <p className="mb-2 text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--brand-purple)' }}>
          Sprezz Integrated Limited
        </p>
        <h1 style={{ color: 'var(--brand-primary)' }}>ATiMs</h1>
        {error && <p className="error">{error}</p>}
        {children}
      </div>
    </main>
  );
}

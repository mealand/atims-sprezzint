import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { AuthCard } from './Register';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [ nexusId, setNexusId ] = useState('');
  const [ password, setPassword ] = useState('');
  const [ error, setError ] = useState<string | null>(null);
  const [ submitting, setSubmitting ] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(nexusId.toUpperCase(), password);
      nav('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard error={error}>
      <h2>Login</h2>
      <form onSubmit={submit}>
        <input value={nexusId} onChange={(e) => setNexusId(e.target.value)}
          placeholder="Nexus ID (e.g. NX-FR-1A2B3C)" required className="uppercase" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Password" required />
        <button className="atims-primary" disabled={submitting}>{submitting ? 'Signing in…' : 'Login'}</button>
      </form>
      <p className="muted">No account yet? <Link to="/register">Register</Link></p>
    </AuthCard>
  );
}

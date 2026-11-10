import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import DashboardLayout from '../../components/DashboardLayout';
import { useAuth } from '../../lib/auth';

export default function CreateBatch() {
  const { me } = useAuth();
  const nav = useNavigate();
  const [ form, setForm ] = useState<Record<string, string>>({
    commodity: '', variety: '', quantity: '', unit: 'kg',
    production_date: '', origin_state: '', destination_country: '', notes: '',
  });
  const [ error, setError ] = useState<string | null>(null);
  const [ submitting, setSubmitting ] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    try {
      const d = await api<{ batch: { id: string } }>('/batches', {
        method: 'POST',
        body: { ...form, quantity: Number(form.quantity), variety: form.variety || undefined },
      });
      nav(`/batches/${d.batch.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  const F = (name: string, label: string, type = 'text', extra: Record<string, unknown> = {}) => (
    <label>
      <span>{label}</span>
      <input type={type} value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value } as Record<string, string>)} required={type !== 'text'} {...extra} />
    </label>
  );

  return (
    <DashboardLayout title="Create batch" actions={<a href="/">← Back to dashboard</a>}>
      <form className="form card" onSubmit={submit}>
        <p className="muted">Logged in as <strong>{me?.nexus_id}</strong> — genesis event will be hash-chained on creation.</p>
        {F('commodity', 'Commodity *)')}
        {F('variety', 'Variety')}
        {F('quantity', 'Quantity *)', 'number', { min: 0, step: 'any' })}
        <label><span>Unit</span>
          <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
            {['kg','tonne','bag','crate','litre'].map((u) => <option key={u}>{u}</option>)}
          </select>
        </label>
        {F('production_date', 'Production date *)', 'date')}
        {F('origin_state', 'Origin state')}
        {F('destination_country', 'Destination country (ISO code)')}
        {F('notes', 'Notes')}
        {error && <p className="error">{error}</p>}
        <button className="atims-primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create batch'}</button>
      </form>
    </DashboardLayout>
  );
}

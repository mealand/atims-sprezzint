import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { brand } from '../lib/brand';

interface TraceData {
  batch: { trace_id: string; commodity: string; quantity: number; unit: string; current_stage: string; production_date: string; destination_country: string | null };
  history: Array<{ seq: number; event_type: string; to_stage: string | null; created_at: string }>;
  integrity: { valid: boolean; problems: string[] };
}

/** Public, no-auth consumer trace page. */
export default function Trace() {
  const traceId = window.location.pathname.split('/').pop()?.toUpperCase();
  const { data, error, isLoading } = useQuery<TraceData>({
    queryKey: ['trace', traceId],
    queryFn: () => api(`/trace/${traceId}`),
    enabled: !!traceId,
  });
  const [ input, setInput ] = useState('');

  if (!traceId) {
    return (
      <main className="center">
        <h1 style={{ color: brand.colors.primary }}>ATiMs Trace</h1>
        <form onSubmit={(e) => { e.preventDefault(); window.location.href = `/trace/${input.trim().toUpperCase()}`; }}>
          <input placeholder="Enter trace ID e.g. CROP-2026-XXXX" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="atims-primary">Search</button>
        </form>
      </main>
    );
  }
  if (isLoading || error) return <main className="center"><p>{isLoading ? 'Loading…' : (error as Error).message}</p></main>;
  if (!data) return null;
  const { batch, history, integrity } = data;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header style={{ borderBottom: `3px solid ${integrity.valid ? brand.colors.green : brand.colors.primary}` }} className="pb-4">
        <p className="text-sm uppercase tracking-widest" style={{ color: brand.colors.purple }}>Sprezz Integrated Limited · ATiMs</p>
        <h1 className="mono">{batch.trace_id}</h1>
        <p>{batch.commodity} — {batch.quantity} {batch.unit} · produced {batch.production_date}</p>
        <p className="pill" style={{ background: integrity.valid ? brand.colors.green : brand.colors.primary, color: '#fff', display: 'inline-block' }}>
          {integrity.valid ? '✓ Chain verified — signature & hash intact' : '✗ Integrity failure'}
        </p>
      </header>
      <ol className="trace-steps">
        {history.map((h) => (
          <li key={h.seq}>
            <span className="mono">#{h.seq}</span> <strong>{h.event_type}</strong>
            {h.to_stage && <> → <code>{h.to_stage}</code></>}
            <span className="muted"> · {new Date(h.created_at).toLocaleString()}</span>
          </li>
        ))}
      </ol>
      <p className="tiny muted">Information on this page comes from a hash-chained, signature-verified event log anchored in a public timestamping service. No trust in ATiMs servers required.</p>
    </main>
  );
}

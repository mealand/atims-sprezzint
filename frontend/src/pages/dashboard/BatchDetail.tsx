import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import DashboardLayout from '../../components/DashboardLayout';
import { useAuth } from '../../lib/auth';
import { StageBadge, StatusPill } from './FarmerDashboard';
import { STAGES } from '@atims/shared';

interface EventView {
  id: string; seq: number; event_type: string; to_stage: string | null; created_at: string;
  payload: unknown; integrity?: string;
}
interface BatchDetailData {
  batch: { id: string; trace_id: string; commodity: string; quantity: number; unit: string;
    current_stage: string; compliance_status: string; production_date: string; [k: string]: unknown };
  events: EventView[];
  evidence: Array<{ id: string; evidence_type: string; file_hash: string; created_at: string; issuer_role?: string }>;
}

const NEXT = ['HARVESTED', 'AGGREGATED', 'PACKED', 'IN_TRANSIT', 'AT_PORT', 'EXPORTED', 'DELIVERED'];

export default function BatchDetail() {
  const { id } = useParams();
  const { me } = useAuth();
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ['batch', id],
    queryFn: () => api<BatchDetailData>(`/batches/${id}`),
  });
  const [ eventErr, setEventErr ] = useState<string | null>(null);
  const [ note, setNote ] = useState('');
  const [ evidence, setEvidence ] = useState({ evidence_type: 'PHOTO', file_hash: '' });

  const advance = useMutation({
    mutationFn: async () => {
      const batch = data!.batch;
      const next = NEXT[NEXT.indexOf(batch.current_stage) + 1];
      if (!next) throw new Error('already delivered');
      return api(`/batches/${batch.id}/events`, {
        method: 'POST',
        body: { event_type: 'STAGE_ADVANCE', to_stage: next, payload: { advanced_by: me?.nexus_id } },
      });
    },
    onSuccess: () => { setEventErr(null); qc.invalidateQueries({ queryKey: ['batch', id] }); },
    onError: (e: { message: string }) => setEventErr(e.message),
  });

  const transfer = useMutation({
    mutationFn: async (toEntityId: string) =>
      api(`/batches/${data!.batch.id}/events`, {
        method: 'POST',
        body: { event_type: 'CUSTODY_TRANSFER', payload: { to_entity_id: toEntityId } },
      }),
    onSuccess: () => { setEventErr(null); qc.invalidateQueries({ queryKey: ['batch', id] }); },
    onError: (e: { message: string }) => setEventErr(e.message),
  });

  const addNote = useMutation({
    mutationFn: () => api(`/batches/${data!.batch.id}/events`, {
      method: 'POST', body: { event_type: 'NOTE', payload: { text: note } },
    }),
    onSuccess: () => { setNote(''); qc.invalidateQueries({ queryKey: ['batch', id] }); },
    onError: (e: { message: string }) => setEventErr(e.message),
  });

  const addEvidence = useMutation({
    mutationFn: () => api(`/batches/${data!.batch.id}/evidence`, {
      method: 'POST',
      body: { evidence_type: evidence.evidence_type, file_hash: evidence.file_hash.trim().toLowerCase() },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['batch', id] }); },
    onError: (e: { message: string }) => setEventErr(e.message),
  });

  if (error) return <p className="error">{(error as Error).message}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { batch, events, evidence: evs } = data;
  const nextStage = NEXT[NEXT.indexOf(batch.current_stage) + 1];

  async function hashFile(file: File) {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    setEvidence({ ...evidence, file_hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') });
  }

  return (
    <DashboardLayout
      title={`Batch ${batch.trace_id}`}
      actions={<> <a href="/">← Dashboard</a> <a href={`/trace/${batch.trace_id}`}>Public trace</a></>}
    >
      <div className="cards">
        <div className="card"><span className="stat-label">Commodity</span><span className="stat-value">{batch.commodity}</span></div>
        <div className="card"><span className="stat-label">Quantity</span><span className="stat-value">{batch.quantity} {batch.unit}</span></div>
        <div className="card"><span className="stat-label">Stage</span><StageBadge stage={batch.current_stage} /></div>
        <div className="card"><span className="stat-label">Compliance</span><StatusPill status={batch.compliance_status} /></div>
      </div>

      {eventErr && <p className="error">{eventErr}</p>}

      {/* ── Actions (current holder only) ── */}
      {me && (
        <section className="card actions">
          <h3>Actions</h3>
          <div className="row">
            <button className="atims-primary" onClick={() => advance.mutate()} disabled={advance.isPending || !nextStage}>
              {nextStage ? `Advance → ${nextStage}` : 'Delivered'}
            </button>
            <CustodyTransfer onTransfer={(x) => transfer.mutate(x)} busy={transfer.isPending} />
          </div>
          <div className="row">
            <input placeholder="Add a signed note…" value={note} onChange={(e) => setNote(e.target.value)} />
            <button onClick={() => addNote.mutate()} disabled={!note || addNote.isPending}>Add note</button>
          </div>
          <div className="row">
            <select value={evidence.evidence_type} onChange={(e) => setEvidence({ ...evidence, evidence_type: e.target.value })}>
              {['PHOTO','PHYTOSANITARY_CERT','LAB_RESULT','PACKHOUSE_LOG','TRANSPORT_DOC','EXPORT_DECLARATION','DELIVERY_NOTE'].map((t) => <option key={t}>{t}</option>)}
            </select>
            <input type="file" onChange={(e) => e.target.files?.[0] && hashFile(e.target.files[0])} />
            <input className="mono" placeholder="SHA-256 (auto-filled on file pick)" value={evidence.file_hash}
              onChange={(e) => setEvidence({ ...evidence, file_hash: e.target.value })} />
            <button className="atims-primary" onClick={() => addEvidence.mutate()} disabled={addEvidence.isPending}>Register evidence</button>
          </div>
        </section>
      )}

      {/* ── Evidence panel ── */}
      <section className="card">
        <h3>Evidence on file ({evs.length})</h3>
        <ul className="evidence">
          {evs.map((e) => (
            <li key={e.id}>
              <code>{e.evidence_type}</code> · {e.issuer_role ?? '?'} · hash <code className="mono tiny">{String(e.file_hash).slice(0, 16)}…</code>
            </li>
          ))}
          {evs.length === 0 && <li className="muted">No evidence yet.</li>}
        </ul>
      </section>

      {/* ── Chain timeline ── */}
      <section className="card">
        <h3>Event chain ({events.length} events)</h3>
        <ol className="chain">
          {events.map((e) => (
            <li key={e.id}>
              <span className="seq mono">#{e.seq}</span>
              <strong>{e.event_type}</strong>
              {e.to_stage && <StageBadge stage={e.to_stage} />}
              <span className="muted">{new Date(e.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ol>
        <p className="muted tiny">Integrity of this chain can be checked independently: <code>GET /verify/{batch.id}</code></p>
      </section>
    </DashboardLayout>
  );
}

function CustodyTransfer({ onTransfer, busy }: { onTransfer: (id: string) => void; busy: boolean }) {
  const [ toId, setToId ] = useState('');
  return (
    <>
      <input placeholder="Transfer custody → Nexus ID" value={toId} onChange={(e) => setToId(e.target.value.toUpperCase())} />
      <button onClick={() => onTransfer(toId)} disabled={!toId || busy}>Transfer</button>
    </>
  );
}

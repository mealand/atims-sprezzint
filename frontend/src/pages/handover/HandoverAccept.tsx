import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { api } from '../../lib/api';
import DashboardLayout from '../../components/DashboardLayout';
import { StageBadge } from '../dashboard/FarmerDashboard';

interface Preview {
  batch: { id: string; trace_id: string; commodity: string; quantity: number; unit: string; current_stage: string };
  from: { nexus_id: string; name: string; role: string };
  expires_at: string;
}

/** M3.1 — accept a custody handover by scanning the holder's QR (or pasting the token). */
export default function HandoverAccept() {
  const [ params, setParams ] = useSearchParams();
  const token = params.get('token') ?? '';
  const [ scanning, setScanning ] = useState(!token);
  const [ scanError, setScanError ] = useState<string | null>(null);
  const [ manual, setManual ] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  // QR scan via camera — token is the payload text.
  useEffect(() => {
    if (!scanning || token) return;
    let stopped = false;
    const reader = new BrowserMultiFormatReader();
    reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
      if (stopped || !result) return;
      const text = result.getText().trim();
      const t = text.startsWith('atims://handover/') ? text.slice('atims://handover/'.length) : text;
      stopped = true;
      setScanning(false);
      setParams({ token: t });
    }).catch((e: Error) => setScanError(e.message || 'Camera unavailable'));
    return () => { stopped = true; };
  }, [scanning, token, setParams]);

  const preview = useQuery({
    queryKey: ['handover', token],
    enabled: Boolean(token),
    queryFn: () => api<Preview>(`/handover/${encodeURIComponent(token)}`),
  });

  const accept = useMutation({
    mutationFn: () => api<{ batch: { id: string } }>(`/handover/${encodeURIComponent(token)}/accept`, { method: 'POST', body: {} }),
    onSuccess: (res: { batch: { id: string } }) => {
      qc.invalidateQueries({ queryKey: ['batches'] });
      navigate(`/batches/${res.batch.id}`);
    },
  });

  return (
    <DashboardLayout title="Receive batch" actions={<a href="/">← Dashboard</a>}>
      {!token && (scanning ? (
        <section className="card">
          <h3>Scan handover QR</h3>
          <video ref={videoRef} style={{ width: '100%', maxWidth: 420, borderRadius: 12 }} />
          {scanError && <p className="error">{scanError}</p>}
          <div className="row">
            <input placeholder="…or paste handover token" value={manual} onChange={(e) => setManual(e.target.value)} />
            <button disabled={!manual} onClick={() => setParams({ token: manual.trim() })}>Use token</button>
          </div>
        </section>
      ) : (
        <section className="card">
          <p className="muted">Nothing scanned yet.</p>
          <button className="atims-primary" onClick={() => setScanning(true)}>Start camera</button>
        </section>
      ))}

      {token && (preview.error ? (
        <section className="card">
          <p className="error">{(preview.error as Error).message}</p>
          <button onClick={() => setParams({})}>Scan again</button>
        </section>
      ) : preview.data ? (
        <section className="card">
          <h3>Accept custody</h3>
          <ul>
            <li><strong>{preview.data.batch.trace_id}</strong> — {preview.data.batch.commodity}, {preview.data.batch.quantity} {preview.data.batch.unit}</li>
            <li>Stage: <StageBadge stage={preview.data.batch.current_stage} /></li>
            <li>From: {preview.data.from.name} ({preview.data.from.nexus_id}, {preview.data.from.role})</li>
          </ul>
          <p className="muted tiny">Accepting appends a CUSTODY_TRANSFER event to this batch's hash chain and makes you the current holder.</p>
          <div className="row">
            <button className="atims-primary" onClick={() => accept.mutate()} disabled={accept.isPending}>
              {accept.isPending ? 'Accepting…' : 'Accept custody'}
            </button>
            <button onClick={() => setParams({})}>Cancel</button>
          </div>
          {accept.error && <p className="error">{(accept.error as Error).message}</p>}
        </section>
      ) : (
        <p className="muted">Loading handover…</p>
      ))}
    </DashboardLayout>
  );
}

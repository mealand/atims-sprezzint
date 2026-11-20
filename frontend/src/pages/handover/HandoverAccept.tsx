import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { api } from '../../lib/api';
import { ensureKey, signCanonical } from '../../lib/keys';
import type { WireEvent } from '../../lib/events';
import DashboardLayout from '../../components/DashboardLayout';
import { StageBadge } from '../dashboard/FarmerDashboard';

interface Preview {
  batch: { id: string; trace_id: string; commodity: string; quantity: number; unit: string; current_stage: string };
  from: { nexus_id: string; name: string; role: string };
  expires_at: string;
}

/**
 * Pull the handover token out of whatever was scanned or pasted:
 *   https://atims.sprezzint.com/handover/accept?token=XYZ  (the QR the holder shows)
 *   /handover/accept?token=XYZ                             (relative link)
 *   atims://handover/XYZ                                   (legacy QR)
 *   XYZ                                                    (bare token)
 * Mirrors extractHandoverToken in api/src/services/handover.ts.
 */
export function parseHandoverToken(input: string): string {
  const text = input.trim();
  if (!text) return '';
  if (text.startsWith('atims://handover/')) {
    return decodeURIComponent(text.slice('atims://handover/'.length).split(/[?#]/)[0]);
  }
  const m = text.match(/[?&]token=([^&#\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return text;
}

/** Retries when another event lands between dry-run and submit (409 STALE_EVENT). */
const MAX_ATTEMPTS = 3;

/**
 * Accept with a signed CUSTODY_TRANSFER: dry-run to get the exact wire event,
 * sign it with this device's key, then submit the signature with the echoed
 * created_at and seq. The server commits it in one transaction.
 */
async function acceptSigned(token: string): Promise<{ batch: { id: string } }> {
  const key = await ensureKey();
  const path = `/handover/${encodeURIComponent(token)}/accept`;
  for (let attempt = 1; ; attempt++) {
    const dry = await api<{ wire_event: WireEvent }>(path, { method: 'POST', body: { actor_pubkey: key.pubkeyB64, dry_run: true } });
    const actor_sig = await signCanonical(dry.wire_event, key.seed);
    try {
      return await api<{ batch: { id: string } }>(path, {
        method: 'POST',
        body: { actor_pubkey: key.pubkeyB64, actor_sig, created_at: dry.wire_event.created_at, seq: dry.wire_event.seq },
      });
    } catch (err) {
      const stale = (err as { data?: { code?: string } })?.data?.code === 'STALE_EVENT';
      if (stale && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
}

/** M3.1: accept a custody handover by scanning the holder's QR (or pasting the link or token). */
export default function HandoverAccept() {
  const [ params, setParams ] = useSearchParams();
  const token = parseHandoverToken(params.get('token') ?? '');
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
      const t = parseHandoverToken(result.getText());
      if (!t) return;
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
    mutationFn: () => acceptSigned(token),
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
            <input placeholder="…or paste the handover link or token" value={manual} onChange={(e) => setManual(e.target.value)} />
            <button disabled={!parseHandoverToken(manual)} onClick={() => setParams({ token: parseHandoverToken(manual) })}>Use link</button>
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
          <p className="muted tiny">Accepting signs a CUSTODY_TRANSFER event with this device's key, appends it to the batch's hash chain and makes you the current holder.</p>
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

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { verifyChainIndependent, type VerifyEvent } from '@atims/shared';
import { api } from '../lib/api';
import { AuthCard } from './auth/Register';

interface Result {
  valid: boolean; problems: string[]; warnings: string[];
  signed_events: number; unsigned_events: number;
}

/**
 * M4 — independent verification page. Fetches the RAW event chain and
 * recomputes every hash, prev-link and signature IN THE BROWSER.
 * No server verdict is trusted — if this page says "valid", you proved it yourself.
 */
export default function Verify() {
  const [ batch, setBatch ] = useState('');
  const [ result, setResult ] = useState<{ trace: string; count: number; r: Result } | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setResult(null);
    try {
      const { trace_id, events } = await api<{ trace_id: string; events: VerifyEvent[] }>(
        `/verify/${encodeURIComponent(batch.trim())}`,
      );
      setResult({ trace: trace_id, count: events.length, r: await verifyChainIndependent(events) });
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <AuthCard>
      <h2>Verify a batch</h2>
      <p className="muted tiny">
        Every payload hash, prev-link and signature is recomputed <strong>in your browser</strong> —
        the server's word is never trusted.
      </p>
      <form onSubmit={run}>
        <input value={batch} onChange={(e) => setBatch(e.target.value)}
          placeholder="Trace ID (e.g. CROP-2026-E8189B9C)" required />
        <button className="atims-primary" disabled={busy}>{busy ? 'Verifying…' : 'Verify chain'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {result && (
        <div>
          <h3>{result.r.valid ? '✓ Chain valid' : '✗ CHAIN INVALID'}</h3>
          <p style={{ color: result.r.valid ? 'var(--brand-green)' : 'var(--brand-primary)' }}>
            Batch <strong>{result.trace}</strong> · {result.count} events ·
            {' '}{result.r.signed_events} signed / {result.r.unsigned_events} unsigned
          </p>
          {result.r.warnings.map((w) => <p key={w} className="muted tiny">⚠ {w}</p>)}
          {result.r.problems.map((p) => <p key={p} className="error">{p}</p>)}
          {result.r.valid && (
            <p className="muted tiny">
              All {result.count} payload hashes, prev-links and {result.r.signed_events} signature(s)
              were recomputed locally — you just proved this history is intact.
            </p>
          )}
        </div>
      )}
      <p className="muted"><Link to="/">← Home</Link></p>
    </AuthCard>
  );
}

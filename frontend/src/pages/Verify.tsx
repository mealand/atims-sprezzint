/**
 * Independent verification page. Fetches the RAW event chain and recomputes every
 * hash, prev link and signature in the browser (shared/src/verify.ts). No server
 * verdict is trusted: if this page says verified, this device proved it.
 * Same proof code as the public trace page (pages/Trace.tsx).
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from '../components/ui';
import {
  AnchorPanel, ProofBanner, PublicShell, eventLabel, fmtDate, proveChain, type BrowserProof, type TraceView,
} from './Trace';
import { stageLabel } from './dashboards/shared';

export default function Verify() {
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get('id') ?? '');
  const [proof, setProof] = useState<BrowserProof | null>(null);
  const [view, setView] = useState<TraceView | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(raw: string) {
    const id = raw.trim();
    if (!id) return;
    setBusy(true); setProof({ state: 'loading', events: [], problems: [], warnings: [], signed: 0, unsigned: 0, head: null, headSeq: new Map() }); setView(null);
    // The derived view only exists for trace ids; a batch uuid is verified on its own.
    const v = await api<TraceView>(`/trace/${encodeURIComponent(id.toUpperCase())}`).catch(() => null);
    setView(v);
    try {
      setProof(await proveChain(id, v));
    } catch (e) {
      setProof({ state: 'error', events: [], problems: [], warnings: [], signed: 0, unsigned: 0, head: null, headSeq: new Map(), error: (e as Error).message });
    } finally { setBusy(false); }
  }

  // Deep link: /verify?id=CROP-... runs straight away.
  useEffect(() => {
    const id = params.get('id');
    if (id) void run(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PublicShell>
      <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-ink sm:text-3xl">
        <ShieldCheck className="size-7 text-primary" aria-hidden /> Verify a batch
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Every payload hash, link and signature is recomputed in your browser. The server's word is never taken.
      </p>

      <form className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => {
        e.preventDefault();
        setParams(input.trim() ? { id: input.trim() } : {}, { replace: true });
        void run(input);
      }}>
        <Field label="Trace ID or batch ID" className="sm:flex-1">
          <Input className="font-mono" value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="CROP-2026-XXXXXXXX" autoComplete="off" autoCapitalize="characters" required />
        </Field>
        <Button type="submit" loading={busy}>{busy ? 'Verifying' : 'Verify chain'}</Button>
      </form>

      {proof && (
        <div className="mt-6 flex flex-col gap-4">
          <ProofBanner proof={proof} />
          {view && (
            <Card>
              <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-mono font-semibold text-ink">{view.batch.trace_id}</p>
                  <p className="text-sm text-ink-muted">
                    <span className="capitalize">{view.batch.commodity}</span>, {Number(view.batch.quantity).toLocaleString()} {view.batch.unit}
                    {' · '}{stageLabel(view.batch.current_stage)}{view.corridor && view.corridor.code !== 'DEFAULT' ? ` · ${view.corridor.code}` : ''}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/trace/${encodeURIComponent(view.batch.trace_id)}`}>Full trace <ArrowRight aria-hidden /></Link>
                </Button>
              </CardContent>
            </Card>
          )}
          {view && <AnchorPanel anchors={view.anchors} proof={proof} traceId={view.batch.trace_id} />}
          {proof.events.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Events checked ({proof.events.length})</CardTitle>
                <CardDescription>{proof.signed} signed on a device, {proof.unsigned} recorded by the server.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="divide-y divide-line rounded-lg border border-line">
                  {proof.events.map((e) => {
                    const bad = proof.problems.some((p) => p.startsWith(`seq ${e.seq}:`));
                    return (
                      <li key={e.seq} className="flex flex-col gap-0.5 p-2.5 text-sm sm:flex-row sm:items-center sm:gap-3">
                        <span className="font-mono text-xs text-ink-subtle">#{e.seq}</span>
                        <span className="font-medium text-ink sm:w-52">
                          {eventLabel(e.event_type)}{e.to_stage && e.event_type !== 'BATCH_CREATED' ? `: ${stageLabel(e.to_stage)}` : ''}
                        </span>
                        <span className="text-xs text-ink-muted">{fmtDate(e.created_at)} · {e.actor_sig ? 'device-signed' : 'server-recorded'}</span>
                        <span className={bad ? 'text-xs font-semibold text-primary-dark sm:ml-auto' : 'text-xs font-semibold text-brand-green-ink sm:ml-auto'}>
                          {bad ? 'problem' : 'ok'}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </PublicShell>
  );
}

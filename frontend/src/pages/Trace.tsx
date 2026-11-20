/**
 * Public trace page: what a buyer sees after scanning the QR on a batch label.
 *
 * Two fetches, and the second one is the proof:
 *  1. GET /trace/:trace_id  a derived view (route, gates, evidence, custody, anchors)
 *     that carries no private data.
 *  2. GET /verify/:trace_id the raw signed event chain. Every payload hash, prev link
 *     and signature is recomputed here, in the browser (verifyChainIndependent), and
 *     every item of the derived view is checked against the verified events by seq
 *     and payload hash. "Chain verified in your browser" appears only when both pass.
 *
 * The proof helpers are exported for the /verify page and the batch detail page.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight, Bitcoin, ChevronDown, CircleCheck, Circle, CircleAlert, Download, FileText, LoaderCircle,
  MapPin, Search, ShieldAlert, ShieldCheck, Truck,
} from 'lucide-react';
import { canonicalize, verifyChainIndependent, type VerifyEvent } from '@atims/shared';
import { api } from '../lib/api';
import {
  Badge, BrandLockup, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Input,
  LoadingRows, RoleBadge, TrustBadge, cn, roleMeta, trustTierOf,
} from '../components/ui';
import { stageLabel } from './dashboards/shared';
import { docLabel } from './dashboards/requirements';

/* ── Types (GET /trace/:trace_id) ───────────────────────────────────────── */

export interface TraceGateItem {
  kind: 'evidence' | 'event'; type: string; supplied_by: string[]; analytes?: string[]; satisfied: boolean;
  satisfied_by?: { seq: number; issuer_role: string; issuer_trust_tier: string | null; file_hash?: string };
}
export interface TraceView {
  batch: {
    trace_id: string; commodity: string; variety: string | null; quantity: number | string; unit: string;
    production_date: string; origin_state: string | null; destination_country: string | null;
    current_stage: string; compliance_status: string | null; created_at: string | null;
  };
  corridor: { code: string; name: string; origin_country: string | null; destination_country: string | null; commodity: string | null; description: string } | null;
  route: Array<{
    stage: string; description: string | null; reached: boolean; reached_at: string | null; reached_seq: number | null;
    gate: { passed: boolean; items: TraceGateItem[] } | null;
  }>;
  history: Array<{
    seq: number; event_type: string; to_stage: string | null; created_at: string; payload_hash: string; signed: boolean;
    actor_role: string; actor_trust_tier: string | null; detail: Record<string, unknown>;
  }>;
  evidence: Array<{
    seq: number; evidence_type: string; file_hash: string; created_at: string;
    issuer_role: string; issuer_trust_tier: string | null; analytes?: string[];
  }>;
  custody: Array<{ seq: number; at: string | null; from_role: string | null; to_role: string; to_trust_tier: string | null }>;
  head_hash: string | null;
  anchors: Array<{
    head_hash: string; confirmed: boolean; block_height: number | null; submitted_at: string;
    confirmed_at: string | null; is_current_head: boolean; ots_file: string | null;
  }>;
  server_integrity: { valid: boolean; problems: string[] };
}

/* ── Browser proof ──────────────────────────────────────────────────────── */

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The chain head after `e`: the prev_hash the next event would carry (same frozen format as the server). */
export function headAfter(e: VerifyEvent): Promise<string> {
  return sha256Hex(canonicalize({
    batch_id: e.batch_id, seq: e.seq, payload_hash: e.payload_hash,
    actor_pubkey: e.actor_pubkey ?? null, actor_sig: e.actor_sig ?? null,
  }));
}

const sameTime = (a: string | null | undefined, b: string | null | undefined) =>
  a != null && b != null && new Date(a).valueOf() === new Date(b).valueOf();

/**
 * Check every item of the derived view against the verified raw events.
 * Returns problems; empty means the view says nothing the chain does not.
 */
export function crossCheck(view: TraceView, events: VerifyEvent[], browserHead: string | null): string[] {
  const out: string[] = [];
  const bySeq = new Map(events.map((e) => [e.seq, e]));
  if (view.history.length !== events.length) out.push(`summary lists ${view.history.length} events, the chain has ${events.length}`);
  for (const h of view.history) {
    const e = bySeq.get(h.seq);
    if (!e) { out.push(`event #${h.seq} is not on the chain`); continue; }
    if (e.payload_hash !== h.payload_hash) out.push(`event #${h.seq}: hash differs from the chain`);
    if (e.event_type !== h.event_type || (e.to_stage ?? null) !== (h.to_stage ?? null) || !sameTime(e.created_at, h.created_at)) {
      out.push(`event #${h.seq}: summary differs from the chain`);
    }
  }
  for (const ev of view.evidence) {
    const p = (bySeq.get(ev.seq)?.payload ?? {}) as Record<string, unknown>;
    if (bySeq.get(ev.seq)?.event_type !== 'EVIDENCE_ADDED' || p.evidence_type !== ev.evidence_type
      || p.file_hash !== ev.file_hash || p.issued_by_role !== ev.issuer_role) {
      out.push(`document at #${ev.seq} differs from the chain`);
    }
  }
  for (const r of view.route) {
    if (r.reached_seq === null) continue;
    const e = bySeq.get(r.reached_seq);
    if (!e || (e.to_stage ?? null) !== r.stage) out.push(`stage ${r.stage} is not reached by event #${r.reached_seq}`);
  }
  if (browserHead && view.head_hash && browserHead !== view.head_hash) out.push('the chain head differs from the summary');
  return out;
}

export interface BrowserProof {
  state: 'loading' | 'verified' | 'failed' | 'error';
  events: VerifyEvent[];
  problems: string[];
  warnings: string[];
  signed: number;
  unsigned: number;
  /** Head of the verified chain, computed here. */
  head: string | null;
  /** head hash -> seq it covers, for every prefix of the chain. */
  headSeq: Map<string, number>;
  error?: string;
}

const EMPTY_PROOF: BrowserProof = { state: 'loading', events: [], problems: [], warnings: [], signed: 0, unsigned: 0, head: null, headSeq: new Map() };

/** Verify the raw chain for `id` (trace or batch id) in the browser; cross-check `view` when given. */
export async function proveChain(id: string, view?: TraceView | null): Promise<BrowserProof> {
  const { events } = await api<{ trace_id: string; events: VerifyEvent[] }>(`/verify/${encodeURIComponent(id)}`);
  const r = await verifyChainIndependent(events);
  const headSeq = new Map<string, number>();
  for (const e of events) headSeq.set(await headAfter(e), e.seq);
  const head = events.length ? await headAfter(events[events.length - 1]) : null;
  const problems = [...r.problems];
  if (events.length === 0) problems.push('the chain is empty');
  if (view) problems.push(...crossCheck(view, events, head));
  return {
    state: problems.length ? 'failed' : 'verified', events, problems, warnings: r.warnings,
    signed: r.signed_events, unsigned: r.unsigned_events, head, headSeq,
  };
}

/** React hook around proveChain. Re-runs when the view changes. */
export function useBrowserProof(id: string | undefined, view?: TraceView | null, enabled = true): BrowserProof {
  const [proof, setProof] = useState<BrowserProof>(EMPTY_PROOF);
  const viewKey = view ? `${view.history.length}:${view.head_hash}` : 'none';
  useEffect(() => {
    if (!id || !enabled) return;
    let live = true;
    setProof(EMPTY_PROOF);
    proveChain(id, view).then(
      (p) => { if (live) setProof(p); },
      (e) => { if (live) setProof({ ...EMPTY_PROOF, state: 'error', error: (e as Error).message || 'could not load the chain' }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, viewKey, enabled]);
  return proof;
}

/* ── Wording ────────────────────────────────────────────────────────────── */

const TIER_ADJ: Record<string, string> = { self_verified: 'self-verified', kyb_verified: 'KYB-verified', registered: 'unverified' };

/** "a self-verified inspector", "a KYB-verified lab", "an unverified exporter". */
export function partyPhrase(role: string, tier: string | null | undefined): string {
  const adj = tier ? TIER_ADJ[tier] ?? tier.replace(/_/g, ' ') : '';
  const words = [adj, roleMeta(role).label.toLowerCase()].filter(Boolean).join(' ');
  return `${/^[aeiou]/i.test(words) ? 'an' : 'a'} ${words}`;
}

/** "Phytosanitary certificate issued by a self-verified inspector". */
export function issuerPhrase(type: string, role: string, tier: string | null | undefined): string {
  return `${docLabel(type)} issued by ${partyPhrase(role, tier)}`;
}

const COUNTRY: Record<string, string> = { NG: 'Nigeria', EU: 'European Union', AE: 'United Arab Emirates' };
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  if (COUNTRY[code]) return COUNTRY[code];
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code; } catch { return code; }
}

export const fmtDate = (s: string | null | undefined, withTime = true) => {
  if (!s) return '';
  const d = new Date(s);
  return withTime
    ? d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
};

const supplierPhrase = (supplied: string[]) => {
  if (!supplied.length) return 'the holder of the batch';
  if (supplied[0] === 'batch_buyer') return 'the buyer named on the batch';
  return supplied.map((r) => `${/^[aeiou]/i.test(roleMeta(r).label) ? 'an' : 'a'} ${roleMeta(r).label.toLowerCase()}`).join(' or ');
};

const EVENT_LABEL: Record<string, string> = {
  BATCH_CREATED: 'Batch created', CUSTODY_TRANSFER: 'Custody handed over', EVIDENCE_ADDED: 'Document added',
  INSPECTION_SIGNOFF: 'Inspector sign-off', STAGE_ADVANCE: 'Stage advanced', GATE_REJECTED: 'Advance blocked by gate',
  NOTE: 'Note', DELIVERY_CONFIRMED: 'Delivery confirmed by buyer',
};
export const eventLabel = (t: string) => EVENT_LABEL[t] ?? t;

/** "MRL", "aflatoxin", "ethylene oxide": acronyms stay upper case. */
export const analyteLabel = (a: string) => (a.length <= 4 ? a.toUpperCase() : a.replace(/_/g, ' ').toLowerCase());

const short = (h: string, n = 12) => `${h.slice(0, n)}…${h.slice(-6)}`;

/* ── Shared proof components ────────────────────────────────────────────── */

/** The verdict banner. Green only when the browser verification passed. */
export function ProofBanner({ proof, className, compact }: { proof: BrowserProof; className?: string; compact?: boolean }) {
  if (proof.state === 'loading') {
    return (
      <div role="status" className={cn('flex items-center gap-3 rounded-xl border border-line bg-surface p-4', className)}>
        <LoaderCircle className="size-6 shrink-0 animate-spin text-ink-muted" aria-hidden />
        <div>
          <p className="font-semibold text-ink">Verifying the chain in your browser</p>
          <p className="text-sm text-ink-muted">Recomputing every hash and signature.</p>
        </div>
      </div>
    );
  }
  if (proof.state === 'verified') {
    return (
      <div role="status" className={cn('rounded-xl border border-brand-green/40 bg-brand-green-soft p-4', className)}>
        <p className="flex items-center gap-2 font-display text-lg font-bold text-brand-green-ink">
          <ShieldCheck className="size-6 shrink-0" aria-hidden /> Chain verified in your browser
        </p>
        <p className="mt-1 text-sm text-ink">
          {proof.events.length} events. Every payload hash and link was recomputed on this device{proof.signed > 0 && <>, and {proof.signed} device {proof.signed === 1 ? 'signature' : 'signatures'} checked</>}.
          {!compact && ' Everything on this page matches the verified chain.'}
        </p>
        {!compact && proof.unsigned > 0 && (
          <p className="mt-1 text-xs text-ink-muted">
            {proof.unsigned} {proof.unsigned === 1 ? 'event was' : 'events were'} recorded by the ATiMs server rather than signed on a device
            (batch creation, document registration, blocked advances). They are hash-linked like the rest, so they cannot be changed afterwards.
          </p>
        )}
      </div>
    );
  }
  return (
    <div role="alert" className={cn('rounded-xl border border-primary/40 bg-primary-soft p-4', className)}>
      <p className="flex items-center gap-2 font-display text-lg font-bold text-primary-dark">
        <ShieldAlert className="size-6 shrink-0" aria-hidden />
        {proof.state === 'error' ? 'Could not verify this chain' : 'Verification failed'}
      </p>
      <p className="mt-1 text-sm text-ink">
        {proof.state === 'error'
          ? `The raw chain could not be loaded (${proof.error}). Nothing on this page has been verified.`
          : 'Your browser found problems in this batch history. Do not rely on it until they are explained.'}
      </p>
      {proof.problems.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-primary-dark">
          {proof.problems.slice(0, 12).map((p) => <li key={p}>{p}</li>)}
          {proof.problems.length > 12 && <li>and {proof.problems.length - 12} more</li>}
        </ul>
      )}
    </div>
  );
}

/** Bitcoin anchor status for the latest verified state of the chain. */
export function AnchorPanel({ anchors, proof, traceId }: { anchors: TraceView['anchors']; proof: BrowserProof; traceId: string }) {
  const head = proof.state === 'verified' ? proof.head : null;
  const current = head ? anchors.find((a) => a.head_hash === head) : undefined;
  const lastConfirmed = anchors.filter((a) => a.confirmed).sort((a, b) => (b.block_height ?? 0) - (a.block_height ?? 0))[0];
  const covers = (a: { head_hash: string }) => proof.headSeq.get(a.head_hash);

  let status: ReactNode;
  if (!head) {
    status = <p className="text-sm text-ink-muted">Shown once the chain is verified in your browser.</p>;
  } else if (current?.confirmed) {
    status = (
      <p className="flex items-start gap-2 text-sm text-ink">
        <CircleCheck className="mt-0.5 size-5 shrink-0 text-brand-green-ink" aria-hidden />
        <span>The latest state of this batch is timestamped in Bitcoin block <strong className="tabular-nums">{current.block_height?.toLocaleString()}</strong>{current.confirmed_at && <>, confirmed {fmtDate(current.confirmed_at)}</>}.</span>
      </p>
    );
  } else if (current) {
    status = (
      <p className="flex items-start gap-2 text-sm text-ink">
        <LoaderCircle className="mt-0.5 size-5 shrink-0 text-brand-yellow-ink" aria-hidden />
        <span>The latest state was submitted to OpenTimestamps {fmtDate(current.submitted_at)} and is waiting for a Bitcoin block. This usually takes a few hours.</span>
      </p>
    );
  } else {
    status = (
      <p className="flex items-start gap-2 text-sm text-ink">
        <Circle className="mt-0.5 size-5 shrink-0 text-ink-subtle" aria-hidden />
        <span>The latest state is not timestamped yet. ATiMs submits a new timestamp each time the chain changes, every few minutes.</span>
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bitcoin className="size-5 text-brand-yellow-ink" aria-hidden /> Bitcoin timestamp</CardTitle>
        <CardDescription>Proves the history existed at that time. Made with OpenTimestamps, free and public.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status}
        {head && lastConfirmed && lastConfirmed !== current && (
          <p className="text-sm text-ink-muted">
            Earlier state: events 0 to {covers(lastConfirmed) ?? '?'} are in Bitcoin block {lastConfirmed.block_height?.toLocaleString()}.
          </p>
        )}
        {anchors.length > 0 && (
          <details className="group rounded-lg border border-line">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-semibold text-ink">
              All timestamps ({anchors.length}) <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="divide-y divide-line border-t border-line">
              {anchors.map((a) => (
                <li key={a.head_hash} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-ink-muted" title={a.head_hash}>{short(a.head_hash)}</p>
                    <p className="text-ink">
                      {covers(a) !== undefined ? `Events 0 to ${covers(a)}` : 'Earlier head'}
                      {' · '}
                      {a.confirmed ? `block ${a.block_height?.toLocaleString()}` : 'pending'}
                    </p>
                  </div>
                  {a.ots_file && (
                    <a className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                      href={`data:application/octet-stream;base64,${a.ots_file}`}
                      download={`${traceId}-${a.head_hash.slice(0, 12)}.ots`}>
                      <Download className="size-4" aria-hidden /> .ots proof
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <p className="border-t border-line p-3 text-xs text-ink-muted">
              This page checks that a timestamp covers the verified head. To check the Bitcoin attestation itself, use the OpenTimestamps
              client: <code className="font-mono">ots verify -d &lt;head hash&gt; file.ots</code>.
            </p>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div data-ui className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <Link to="/" aria-label="ATiMs home" className="rounded-lg"><BrandLockup /></Link>
          <Link to="/trace" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            <Search className="size-4" aria-hidden /> Look up a batch
          </Link>
        </div>
        <div aria-hidden className="h-0.5 bg-primary" />
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-5 sm:pt-8">{children}</main>
    </div>
  );
}

function TraceSearch() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  return (
    <PublicShell>
      <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">Trace a batch</h1>
      <p className="mt-1 text-sm text-ink-muted">Enter the trace ID printed under the QR code on the batch label.</p>
      <form className="mt-5 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => {
        e.preventDefault();
        const id = input.trim().toUpperCase();
        if (id) navigate(`/trace/${encodeURIComponent(id)}`);
      }}>
        <label htmlFor="trace-id" className="sr-only">Trace ID</label>
        <Input id="trace-id" className="font-mono sm:flex-1" placeholder="CROP-2026-XXXXXXXX" value={input}
          onChange={(e) => setInput(e.target.value)} autoCapitalize="characters" autoComplete="off" />
        <Button type="submit"><Search aria-hidden /> Trace</Button>
      </form>
    </PublicShell>
  );
}

export default function Trace() {
  const params = useParams<{ traceId?: string }>();
  const traceId = params.traceId?.trim().toUpperCase() || undefined;
  const { data: view, error, isLoading } = useQuery<TraceView>({
    queryKey: ['trace', traceId],
    queryFn: () => api(`/trace/${encodeURIComponent(traceId!)}`),
    enabled: !!traceId,
    retry: false,
  });
  const proof = useBrowserProof(traceId, view, Boolean(view));

  if (!traceId) return <TraceSearch />;
  if (isLoading) return <PublicShell><LoadingRows rows={4} label="Loading batch" /></PublicShell>;
  if (error || !view) {
    return (
      <PublicShell>
        <EmptyState icon={Search} title="Batch not found"
          description={<>No batch has the trace ID <span className="font-mono">{traceId}</span>. Check the label and try again.</>}
          action={<Button asChild variant="outline"><Link to="/trace">Search again</Link></Button>} />
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <TraceBody view={view} proof={proof} />
    </PublicShell>
  );
}

function TraceBody({ view, proof }: { view: TraceView; proof: BrowserProof }) {
  const { batch, corridor } = view;
  const origin = [batch.origin_state, countryName(corridor?.origin_country ?? 'NG')].filter(Boolean).join(', ');
  const destination = countryName(corridor?.destination_country ?? batch.destination_country);
  const verified = proof.state === 'verified';

  return (
    <div className="flex flex-col gap-4">
      {/* Identity */}
      <section aria-labelledby="batch-title">
        <p className="text-xs font-semibold uppercase tracking-widest text-ink-muted">Batch trace</p>
        <h1 id="batch-title" className="mt-1 break-all font-mono text-xl font-bold text-ink sm:text-2xl">{batch.trace_id}</h1>
        <p className="mt-1 text-base text-ink">
          <span className="font-semibold capitalize">{batch.commodity}</span>
          {batch.variety && <>, {batch.variety}</>}
          {' · '}<span className="tabular-nums">{Number(batch.quantity).toLocaleString()} {batch.unit}</span>
          {' · '}harvested {fmtDate(batch.production_date, false)}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={batch.current_stage === 'DELIVERED' ? 'success' : 'info'}>{stageLabel(batch.current_stage)}</Badge>
          {corridor && corridor.code !== 'DEFAULT' && <Badge variant="purple">{corridor.code}</Badge>}
          <span className="inline-flex items-center gap-1 text-ink-muted">
            <MapPin className="size-4" aria-hidden /> {origin || 'Origin not stated'}
            {destination && <><ArrowRight className="size-4" aria-label="to" /> {destination}</>}
          </span>
        </div>
        {corridor && corridor.code !== 'DEFAULT' && <p className="mt-2 text-sm text-ink-muted">{corridor.name}. {corridor.description}</p>}
      </section>

      <ProofBanner proof={proof} />

      {/* Route and gates */}
      <Card>
        <CardHeader>
          <CardTitle>Route and gates</CardTitle>
          <CardDescription>A batch can only move to the next stage when the corridor's required documents are on file from the right parties.</CardDescription>
        </CardHeader>
        <CardContent>
          <RouteTimeline route={view.route} verified={verified} />
        </CardContent>
      </Card>

      {/* Evidence */}
      <Card>
        <CardHeader>
          <CardTitle>Documents ({view.evidence.length})</CardTitle>
          <CardDescription>Each document is recorded by its SHA-256 fingerprint. Hash the original file to check it matches.</CardDescription>
        </CardHeader>
        <CardContent>
          {view.evidence.length === 0 ? <p className="text-sm text-ink-muted">No documents yet.</p> : (
            <ul className="flex flex-col gap-3">
              {view.evidence.map((e) => (
                <li key={e.seq} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="flex items-center gap-2 font-semibold text-ink"><FileText className="size-4 text-ink-muted" aria-hidden />{docLabel(e.evidence_type)}</p>
                    <span className="text-xs text-ink-muted">{fmtDate(e.created_at)}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink">{issuerPhrase(e.evidence_type, e.issuer_role, e.issuer_trust_tier)}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <RoleBadge role={e.issuer_role} size="sm" />
                    {e.issuer_trust_tier && <TrustBadge tier={trustTierOf({ trust_tier: e.issuer_trust_tier })} size="sm" />}
                    {e.analytes?.map((a) => <Badge key={a} size="sm">{a.replace(/_/g, ' ')}</Badge>)}
                  </div>
                  <p className="mt-2 break-all font-mono text-[11px] leading-relaxed text-ink-muted">sha256 {e.file_hash}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Custody */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Truck className="size-5 text-ink-muted" aria-hidden /> Custody</CardTitle>
          <CardDescription>Who held the batch. Each handover is signed by the party taking custody.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-2">
            {view.custody.map((c, i) => (
              <li key={c.seq} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-6 text-right font-mono text-xs text-ink-subtle">{i + 1}.</span>
                <RoleBadge role={c.to_role} size="sm" />
                {c.to_trust_tier && <TrustBadge tier={trustTierOf({ trust_tier: c.to_trust_tier })} size="sm" compact />}
                <span className="text-ink-muted">{i === 0 ? 'created the batch' : `took over from ${partyPhrase(c.from_role ?? '', null).replace(/^an? /, 'the ')}`} · {fmtDate(c.at)}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <AnchorPanel anchors={view.anchors} proof={proof} traceId={batch.trace_id} />

      <TechnicalProof view={view} proof={proof} />

      <p className="text-xs text-ink-muted">
        Trust tiers come from the ATiMs registry and are current as of today; they are not part of the signed chain.
        Self-verified accounts confirmed their email and passed automatic checks; KYB-verified accounts had their business documents reviewed.
      </p>
    </div>
  );
}

function RouteTimeline({ route, verified }: { route: TraceView['route']; verified: boolean }) {
  const currentIdx = route.reduce((acc, r, i) => (r.reached ? i : acc), -1);
  return (
    <ol className="flex flex-col">
      {route.map((r, i) => {
        const state = r.reached ? 'done' : i === currentIdx + 1 ? 'next' : 'later';
        const items = r.gate?.items ?? [];
        return (
          <li key={r.stage} className="relative flex gap-3 pb-5 last:pb-0">
            {i < route.length - 1 && (
              <span aria-hidden className={cn('absolute left-[11px] top-7 h-[calc(100%-1.5rem)] w-0.5', r.reached && route[i + 1].reached ? 'bg-brand-green' : 'bg-line')} />
            )}
            <span className={cn('relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2',
              state === 'done' ? 'border-brand-green bg-brand-green text-white' : state === 'next' ? 'border-primary bg-surface' : 'border-line-strong bg-surface')}>
              {state === 'done' ? <CircleCheck className="size-4" aria-hidden /> : <span className="text-[10px] font-bold text-ink-muted">{i + 1}</span>}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2 font-semibold text-ink">
                {stageLabel(r.stage)}
                <span className="text-xs font-normal text-ink-muted">
                  {r.reached ? (i === 0 ? `recorded ${fmtDate(r.reached_at)}` : `gate passed ${fmtDate(r.reached_at)}`) : state === 'next' ? 'next' : 'not reached'}
                </span>
                <span className="sr-only">{verified && r.reached ? ' (checked against the verified chain)' : ''}</span>
              </p>
              {i > 0 && items.length === 0 && <p className="text-sm text-ink-muted">No documents required at this stage.</p>}
              {items.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1">
                  {items.map((it) => {
                    const Icon = it.satisfied ? CircleCheck : r.reached ? CircleAlert : Circle;
                    return (
                      <li key={`${it.kind}-${it.type}`} className="flex items-start gap-2 text-sm">
                        <Icon className={cn('mt-0.5 size-4 shrink-0', it.satisfied ? 'text-brand-green-ink' : 'text-ink-subtle')} aria-hidden />
                        <span className="min-w-0">
                          {it.satisfied && it.satisfied_by
                            ? (it.kind === 'event'
                              ? <>{docLabel(it.type)} by {partyPhrase(it.satisfied_by.issuer_role, it.satisfied_by.issuer_trust_tier)}</>
                              : issuerPhrase(it.type, it.satisfied_by.issuer_role, it.satisfied_by.issuer_trust_tier))
                            : <>{docLabel(it.type)}<span className="text-ink-muted">, needed from {supplierPhrase(it.supplied_by)}</span></>}
                          {it.analytes && <span className="block text-xs text-ink-muted">Covers {it.analytes.map(analyteLabel).join(', ')}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TechnicalProof({ view, proof }: { view: TraceView; proof: BrowserProof }) {
  const base = import.meta.env.VITE_API_URL ?? '/api';
  const signedBySeq = useMemo(() => new Map(proof.events.map((e) => [e.seq, Boolean(e.actor_sig)])), [proof.events]);
  return (
    <details className="group rounded-xl border border-line bg-surface shadow-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 font-display font-bold text-ink sm:px-5">
        Technical proof <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-line p-4 sm:p-5">
        <p className="text-sm text-ink-muted">
          The raw signed events are public at <a className="font-mono text-primary hover:underline" href={`${base}/verify/${view.batch.trace_id}`}>/verify/{view.batch.trace_id}</a>.
          They contain the exact bytes that were hashed and signed, including internal account ids. Re-check them with the
          {' '}<Link className="text-primary hover:underline" to={`/verify?id=${encodeURIComponent(view.batch.trace_id)}`}>verify page</Link> or the open-source atims-verify CLI.
        </p>
        {proof.head && <p className="mt-2 break-all font-mono text-[11px] text-ink-muted">head {proof.head}</p>}
        <ol className="mt-3 divide-y divide-line rounded-lg border border-line">
          {view.history.map((h) => (
            <li key={h.seq} className="flex flex-col gap-0.5 p-2.5 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="font-mono text-xs text-ink-subtle">#{h.seq}</span>
              <span className="font-medium text-ink sm:w-52">{eventLabel(h.event_type)}{h.to_stage && h.event_type !== 'BATCH_CREATED' ? `: ${stageLabel(h.to_stage)}` : ''}</span>
              <span className="text-xs text-ink-muted">{roleMeta(h.actor_role).label} · {(signedBySeq.get(h.seq) ?? h.signed) ? 'device-signed' : 'server-recorded'}</span>
              <span className="truncate font-mono text-[11px] text-ink-subtle sm:ml-auto" title={h.payload_hash}>{short(h.payload_hash, 10)}</span>
            </li>
          ))}
        </ol>
        {proof.warnings.length > 0 && <p className="mt-2 text-xs text-ink-muted">{proof.warnings.length} unsigned (server-recorded) events, listed as warnings by the verifier.</p>}
      </div>
    </details>
  );
}

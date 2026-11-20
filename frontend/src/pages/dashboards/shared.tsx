/**
 * Building blocks shared by every role dashboard: data hooks, batch list,
 * stage and compliance badges, gate checklist, handover QR dialog, evidence
 * upload dialog and the first-visit welcome banner.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import {
  ArrowRight, CircleCheck, CircleAlert, Circle, Copy, FileUp, PartyPopper, QrCode as QrIcon, X,
} from 'lucide-react';
import { STAGES, type Stage } from '@atims/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, EmptyState, Field, Input, LoadingRows, ResponsiveTable, Select, Textarea,
  TrustBadge, cn, roleMeta, trustTierOf, useToast, type Column,
} from '../../components/ui';
import {
  CORRIDORS, checklist, corridorOf, docLabel, nextStage, type ChecklistItem, type CorridorId,
} from './requirements';

/* ── Types and data hooks ───────────────────────────────────────────────── */

export interface Batch {
  id: string; trace_id: string; commodity: string; variety?: string | null; quantity: number | string; unit: string;
  current_stage: string; compliance_status: string; production_date: string; origin_state?: string | null;
  destination_country?: string | null; origin_entity_id: string; current_holder_id: string;
  buyer_id?: string | null; corridor?: string | null; created_at?: string; updated_at?: string;
}

export interface EvidenceRow {
  id: string; evidence_type: string; file_hash: string; created_at: string; actor_id: string;
  issued_by_role?: string | null; meta?: Record<string, unknown>;
}
export interface EventRow { id: string; seq: number; event_type: string; actor_id: string; to_stage: string | null; created_at: string; payload: unknown }
export interface BatchDetail { batch: Batch; events: EventRow[]; evidence: EvidenceRow[] }

export interface MeProfile {
  id: string; nexus_id: string; name: string; role: string; status: string; trust_tier?: string;
  email?: string | null; phone?: string | null; profile?: Record<string, unknown> | null;
  state_province?: string | null; country?: string | null; email_verified_at?: string | null;
  kyb_verified_at?: string | null; created_at?: string; verified_by_nexus_id?: string | null; verified_by_role?: string | null;
}

export function useBatches() {
  return useQuery({ queryKey: ['batches'], queryFn: () => api<{ batches: Batch[] }>('/batches'), select: (d) => d.batches });
}

/** Full detail (events and evidence) for a handful of batches, for checklists. */
export function useBatchDetails(ids: string[]) {
  const results = useQueries({
    queries: ids.map((id) => ({ queryKey: ['batch', id], queryFn: () => api<BatchDetail>(`/batches/${id}`) })),
  });
  const map = new Map<string, BatchDetail>();
  results.forEach((r, i) => { if (r.data) map.set(ids[i], r.data); });
  return { details: map, loading: results.some((r) => r.isLoading) };
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<{ entity: MeProfile }>('/entities/me'), select: (d) => d.entity });
}

export const isActive = (b: Batch) => b.current_stage !== 'DELIVERED';
export const holds = (b: Batch, meId?: string) => Boolean(meId) && b.current_holder_id === meId;

/* ── Badges ─────────────────────────────────────────────────────────────── */

const STAGE_LABEL: Record<string, string> = {
  HARVESTED: 'Harvested', AGGREGATED: 'Aggregated', PACKED: 'Packed', IN_TRANSIT: 'In transit',
  AT_PORT: 'At port', EXPORTED: 'Exported', DELIVERED: 'Delivered',
};
export const stageLabel = (s: string) => STAGE_LABEL[s] ?? s;

export function StageBadge({ stage }: { stage: string }) {
  const i = STAGES.indexOf(stage as Stage);
  return (
    <Badge variant={stage === 'DELIVERED' ? 'success' : 'info'} size="sm">
      <span className="tabular-nums opacity-70">{i >= 0 ? `${i + 1}/${STAGES.length}` : ''}</span> {stageLabel(stage)}
    </Badge>
  );
}

export function ComplianceBadge({ status }: { status: string }) {
  const variant = status === 'compliant' ? 'success' : status === 'blocked' ? 'primary' : 'warning';
  return <Badge variant={variant} size="sm" className="capitalize">{status.replace(/_/g, ' ')}</Badge>;
}

export function CorridorBadge({ batch }: { batch: Batch }) {
  const c = corridorOf(batch);
  return <Badge variant={c === 'DEFAULT' ? 'neutral' : 'purple'} size="sm">{CORRIDORS[c].short}</Badge>;
}

/* ── Batch list ─────────────────────────────────────────────────────────── */

export function batchColumns(extra: Column<Batch>[] = []): Column<Batch>[] {
  return [
    {
      key: 'trace', header: 'Batch', primary: true,
      cell: (b) => (
        <Link to={`/batches/${b.id}`} className="group inline-flex min-w-0 flex-col">
          <span className="truncate font-mono text-sm font-semibold text-primary group-hover:underline">{b.trace_id}</span>
          <span className="text-xs font-normal text-ink-muted">{b.commodity}{b.variety ? `, ${b.variety}` : ''}</span>
        </Link>
      ),
    },
    { key: 'qty', header: 'Quantity', cell: (b) => <span className="tabular-nums">{Number(b.quantity).toLocaleString()} {b.unit}</span> },
    { key: 'stage', header: 'Stage', cell: (b) => <StageBadge stage={b.current_stage} /> },
    { key: 'status', header: 'Compliance', cell: (b) => <ComplianceBadge status={b.compliance_status} /> },
    ...extra,
  ];
}

export function BatchList({ batches, loading, caption, empty, extra, action }: {
  batches: Batch[]; loading?: boolean; caption: string; empty: ReactNode;
  extra?: Column<Batch>[]; action?: (b: Batch) => ReactNode;
}) {
  if (loading) return <LoadingRows rows={3} label={`Loading ${caption.toLowerCase()}`} />;
  return <ResponsiveTable columns={batchColumns(extra)} rows={batches} rowKey={(b) => b.id} caption={caption} empty={empty} rowAction={action} />;
}

/* ── Section wrapper ────────────────────────────────────────────────────── */

export function Section({ title, description, action, children, id }:
  { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode; id?: string }) {
  const hid = id ?? `s-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section aria-labelledby={hid} className="mt-8 first:mt-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 id={hid} className="font-display text-lg font-bold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/* ── Gate checklist ─────────────────────────────────────────────────────── */

export function ChecklistView({ items, compact }: { items: ChecklistItem[]; compact?: boolean }) {
  if (items.length === 0) return <p className="text-sm text-ink-muted">No documents required for this step.</p>;
  return (
    <ul className={cn('flex flex-col', compact ? 'gap-1.5' : 'gap-2')}>
      {items.map((it) => {
        const Icon = it.done ? CircleCheck : it.wrongIssuer ? CircleAlert : Circle;
        return (
          <li key={it.type} className="flex items-start gap-2 text-sm">
            <Icon className={cn('mt-0.5 size-4.5 shrink-0', it.done ? 'text-brand-green-ink' : it.wrongIssuer ? 'text-primary' : 'text-ink-subtle')} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className={cn(it.done ? 'text-ink-muted' : 'font-medium text-ink')}>{it.label}</span>
              <span className="sr-only">{it.done ? ' (on file)' : ' (missing)'}</span>
              {!it.done && (
                <span className="block text-xs text-ink-muted">
                  {it.wrongIssuer ? `On file, but must be issued by ${roleLabel(it.supplier)}` : `Supplied by ${roleLabel(it.supplier)}`}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const roleLabel = (r: string) => (r === 'holder' ? 'the current holder' : `a ${roleMeta(r).label.toLowerCase()}`);

/** Next-gate card for one batch: what the next stage needs and what is on file. */
export function NextGateCard({ batch, detail, footer, stage }:
  { batch: Batch; detail?: BatchDetail; footer?: ReactNode; stage?: Stage }) {
  const target = stage ?? nextStage(batch.current_stage);
  const corridor: CorridorId = corridorOf(batch);
  const items = target && detail ? checklist(corridor, target, detail.evidence, detail.events) : [];
  const missing = items.filter((i) => !i.done).length;
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate font-mono text-sm">
              <Link to={`/batches/${batch.id}`} className="text-primary hover:underline">{batch.trace_id}</Link>
            </CardTitle>
            <CardDescription>{batch.commodity}, {Number(batch.quantity).toLocaleString()} {batch.unit}</CardDescription>
          </div>
          <CorridorBadge batch={batch} />
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {!target ? <p className="text-sm text-ink-muted">Delivered. No further gates.</p> : (
          <>
            <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <StageBadge stage={batch.current_stage} />
              <ArrowRight className="size-4 text-ink-subtle" aria-label="next" />
              <span className="font-semibold text-ink">{stageLabel(target)}</span>
              {detail && (missing === 0
                ? <Badge variant="success" size="sm">Ready</Badge>
                : <Badge variant="warning" size="sm">{missing} missing</Badge>)}
            </p>
            {detail ? <ChecklistView items={items} compact /> : <LoadingRows rows={1} label="Loading checklist" />}
          </>
        )}
      </CardContent>
      {footer && <div className="flex flex-wrap gap-2 border-t border-line p-3 sm:px-5">{footer}</div>}
    </Card>
  );
}

/* ── Pipeline by corridor ───────────────────────────────────────────────── */

export function CorridorPipeline({ batches }: { batches: Batch[] }) {
  const groups = new Map<CorridorId, Batch[]>();
  for (const b of batches) {
    const c = corridorOf(b);
    groups.set(c, [...(groups.get(c) ?? []), b]);
  }
  const order: CorridorId[] = ['NG-EU-SESAME', 'NG-AE-SESAME', 'DEFAULT'];
  const shown = order.filter((c) => groups.has(c) || c !== 'DEFAULT');
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {shown.map((c) => {
        const list = groups.get(c) ?? [];
        const blocked = list.filter((b) => b.compliance_status === 'blocked').length;
        return (
          <Card key={c}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{CORRIDORS[c].label}</CardTitle>
                <span className="text-sm tabular-nums text-ink-muted">{list.length} {list.length === 1 ? 'batch' : 'batches'}</span>
              </div>
              {c !== 'DEFAULT' && <CardDescription className="font-mono text-xs">{c}</CardDescription>}
            </CardHeader>
            <CardContent>
              <ol className="grid grid-cols-4 gap-1.5 sm:grid-cols-7 sm:gap-1" aria-label={`${CORRIDORS[c].label} by stage`}>
                {STAGES.map((s) => {
                  const n = list.filter((b) => b.current_stage === s).length;
                  return (
                    <li key={s} className={cn('flex flex-col items-center rounded-lg px-0.5 py-2 text-center', n ? 'bg-primary-soft' : 'bg-surface-muted')}>
                      <span className={cn('font-display text-lg font-bold tabular-nums', n ? 'text-primary-dark' : 'text-ink-subtle')}>{n}</span>
                      <span className="mt-0.5 text-[10px] leading-tight text-ink-muted">{stageLabel(s)}</span>
                    </li>
                  );
                })}
              </ol>
              {blocked > 0 && <p className="mt-2 text-xs font-medium text-primary-dark">{blocked} blocked by a failed gate</p>}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ── Welcome banner (first visit after sign-up) ─────────────────────────── */

export function WelcomeBanner() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [copied, setCopied] = useState(false);
  if (!me || params.get('welcome') !== '1') return null;
  const tier = trustTierOf(me as { status?: string; trust_tier?: string });
  const dismiss = () => { params.delete('welcome'); setParams(params, { replace: true }); };
  return (
    <div role="status" className="relative mb-6 rounded-xl border border-brand-green/30 bg-brand-green-soft p-4 pr-12 sm:p-5">
      <button type="button" onClick={dismiss} aria-label="Dismiss welcome message"
        className="absolute right-2 top-2 inline-flex size-10 min-h-0 items-center justify-center rounded-full bg-transparent p-0 text-ink-muted hover:bg-surface/60">
        <X className="size-4.5" aria-hidden />
      </button>
      <p className="flex items-center gap-2 font-display font-bold text-brand-green-ink">
        <PartyPopper className="size-5" aria-hidden /> Your account is ready
      </p>
      <p className="mt-1 text-sm text-ink">
        Email confirmed. You can start working now; no admin approval is needed.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-muted">Your Nexus ID:</span>
        <span className="rounded-md bg-surface px-2 py-1 font-mono font-semibold text-ink">{me.nexus_id}</span>
        <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(me.nexus_id); setCopied(true); }}>
          <Copy aria-hidden /> {copied ? 'Copied' : 'Copy'}
        </Button>
        <TrustBadge tier={tier} size="sm" />
      </div>
      <p className="mt-2 text-xs text-ink-muted">Keep your Nexus ID: you use it to sign in. Back up your device key in Settings.</p>
    </div>
  );
}

/* ── Handover dialog ────────────────────────────────────────────────────── */

export function HandoverButton({ batch, size = 'sm', variant = 'outline' }:
  { batch: Batch; size?: 'sm' | 'md'; variant?: 'outline' | 'primary' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}><QrIcon aria-hidden /> Hand over</Button>
      {open && <HandoverDialog batch={batch} onClose={() => setOpen(false)} />}
    </>
  );
}

function HandoverDialog({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const [state, setState] = useState<{ qr: string; url: string; expires_at: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await api<{ token: string; expires_at: string }>(`/batches/${batch.id}/handover/start`, { method: 'POST', body: {} });
        const url = `${location.origin}/handover/accept?token=${encodeURIComponent(res.token)}`;
        const qr = await QRCode.toDataURL(url, { width: 480, margin: 1 });
        if (live) setState({ qr, url, expires_at: res.expires_at });
      } catch (e) {
        if (live) setError((e as Error).message || 'Could not start the handover');
      }
    })();
    return () => { live = false; };
  }, [batch.id]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hand over {batch.trace_id}</DialogTitle>
          <DialogDescription>
            The receiver scans this code with ATiMs (Handover tab) and accepts. Custody moves to them on the ledger.
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-dark">{error}</p>}
        {!error && !state && <LoadingRows rows={2} label="Creating handover code" />}
        {state && (
          <div className="flex flex-col items-center gap-3">
            <img src={state.qr} alt={`Handover QR code for ${batch.trace_id}`} className="size-64 rounded-lg border border-line bg-white p-2" />
            <p className="text-xs text-ink-muted">Valid until {new Date(state.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Single use.</p>
            <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard?.writeText(state.url); setCopied(true); }}>
              <Copy aria-hidden /> {copied ? 'Link copied' : 'Copy link instead'}
            </Button>
          </div>
        )}
        <DialogFooter><Button variant="secondary" onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Evidence upload dialog ─────────────────────────────────────────────── */

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const LAB_ANALYTES = [
  { key: 'mrl', label: 'Pesticide residues (MRL)' },
  { key: 'aflatoxin', label: 'Aflatoxin' },
  { key: 'ethylene_oxide', label: 'Ethylene oxide' },
];

/**
 * Hash a file in the browser, upload it when object storage is enabled, and
 * register it as evidence (POST /batches/:id/evidence). The server records the
 * issuer role itself; the hash is what goes on the chain.
 */
export function EvidenceButton({ batch, types, label = 'Upload', variant = 'primary', size = 'sm' }:
  { batch: Batch; types: string[]; label?: string; variant?: 'primary' | 'outline'; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}><FileUp aria-hidden /> {label}</Button>
      {open && <EvidenceDialog batch={batch} types={types} onClose={() => setOpen(false)} />}
    </>
  );
}

function EvidenceDialog({ batch, types, onClose }: { batch: Batch; types: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState(types[0]);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [results, setResults] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLab = type === 'LAB_REPORT' || type === 'LAB_RESULT';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError('Choose the document file.'); return; }
    setBusy(true); setError(null);
    try {
      const file_hash = await sha256Hex(file);
      let stored = false;
      const up = await api<{ upload_url: string | null; storage_enabled: boolean }>(
        `/batches/${batch.id}/evidence/upload-url`, { method: 'POST', body: { file_hash, evidence_type: type } });
      if (up.storage_enabled && up.upload_url) {
        const put = await fetch(up.upload_url, { method: 'PUT', body: file });
        stored = put.ok;
      }
      const meta: Record<string, unknown> = { file_name: file.name, size: file.size, mime: file.type || undefined };
      if (note.trim()) meta.note = note.trim();
      if (reference.trim()) meta.reference = reference.trim();
      if (isLab) {
        const r = Object.fromEntries(Object.entries(results).filter(([, v]) => v));
        if (Object.keys(r).length) meta.results = r;
      }
      await api(`/batches/${batch.id}/evidence`, { method: 'POST', body: { evidence_type: type, file_hash, meta, stored } });
      toast({ variant: 'success', title: `${docLabel(type)} added`, description: stored ? 'File stored and hash recorded on the chain.' : 'Hash recorded on the chain. Keep the original file.' });
      await Promise.all([qc.invalidateQueries({ queryKey: ['batches'] }), qc.invalidateQueries({ queryKey: ['batch', batch.id] })]);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Upload failed');
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a document to {batch.trace_id}</DialogTitle>
          <DialogDescription>The file is fingerprinted (SHA-256) on this device; the fingerprint goes on the batch ledger.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <p role="alert" className="rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-dark">{error}</p>}
          {types.length > 1 && (
            <Field label="Document type" required>
              <Select value={type} onChange={(e) => setType(e.target.value)} options={types.map((t) => ({ value: t, label: docLabel(t) }))} />
            </Field>
          )}
          <Field label="File" hint="PDF or photo" required>
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="py-2 file:mr-3 file:rounded-md file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm file:font-semibold" />
          </Field>
          <Field label="Reference number" hint="Optional, for example the certificate or report number">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          {isLab && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-medium text-ink">Results</legend>
              {LAB_ANALYTES.map((a) => (
                <Field key={a.key} label={a.label}>
                  <Select value={results[a.key] ?? ''} onChange={(e) => setResults((r) => ({ ...r, [a.key]: e.target.value }))}
                    options={[{ value: '', label: 'Not reported' }, { value: 'pass', label: 'Within limits' }, { value: 'fail', label: 'Above limits' }]} />
                </Field>
              ))}
            </fieldset>
          )}
          <Field label="Note" hint="Optional">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter className="mt-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" loading={busy}>{busy ? 'Recording' : 'Add document'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Empty states ───────────────────────────────────────────────────────── */

export function NexusIdHint({ what }: { what: string }) {
  const { me } = useAuth();
  return (
    <EmptyState title={`No ${what} yet`}
      description={<>Batch holders add you by your Nexus ID <span className="font-mono font-semibold text-ink">{me?.nexus_id}</span>. Share it with the farmers and exporters you work with.</>} />
  );
}

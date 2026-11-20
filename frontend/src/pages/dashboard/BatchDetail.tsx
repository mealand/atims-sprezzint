/**
 * Batch detail: everything a party to a batch needs on one page, phone first.
 *
 *  - stage timeline for the batch's corridor
 *  - the gate for the next stage (server report: what is on file, what is missing, who supplies it)
 *  - the actions this account may take (mirrors api/src/services/access.ts; the API decides)
 *  - documents with issuer role and trust tier, and a view-file link where stored
 *  - custody history
 *  - browser verification of the chain, Bitcoin anchor status and a printable QR label
 *
 * Client events go through the signed flow in lib/events.ts (dry-run, sign on this
 * device, submit). Custody only moves by handover.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import {
  ArrowRight, CircleAlert, CircleCheck, Circle, ClipboardCheck, Copy, ExternalLink, FileText, FileUp, Lock,
  PackageCheck, Printer, QrCode as QrIcon, ShieldCheck, StickyNote, Truck, UserPlus,
} from 'lucide-react';
import { STAGES, type Stage } from '@atims/shared';
import { api } from '../../lib/api';
import { appendSignedEvent } from '../../lib/events';
import { queueEvent, pendingCount, syncQueue } from '../../lib/offline';
import { useAuth } from '../../lib/auth';
import DashboardLayout from '../../components/DashboardLayout';
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, EmptyState, Field, Input, LoadingRows, RoleBadge, Select, Textarea,
  TrustBadge, cn, roleMeta, trustTierOf, useToast,
} from '../../components/ui';
import { ComplianceBadge, HandoverButton, StageBadge, stageLabel, type Batch } from '../dashboards/shared';
import { CORRIDORS, corridorOf, docLabel } from '../dashboards/requirements';
import {
  AnchorPanel, ProofBanner, analyteLabel, countryName, fmtDate, issuerPhrase, partyPhrase, useBrowserProof, type TraceView,
} from '../Trace';

/* ── Types (GET /batches/:id) ───────────────────────────────────────────── */

interface GateItem {
  kind: 'evidence' | 'event'; type: string; supplied_by: string[]; analytes?: string[]; satisfied: boolean;
  problem?: 'missing' | 'wrong_issuer' | 'missing_analytes' | 'no_buyer_named'; missing_analytes?: string[];
}
interface GateReport { pass: boolean; to_stage?: string; corridor?: string; checklist: GateItem[]; description: string }
interface DetailEvent { id: string; seq: number; event_type: string; actor_id: string; to_stage: string | null; created_at: string; payload: Record<string, unknown> | null; actor_sig: string | null }
interface DetailEvidence {
  id: string; event_id: string; actor_id: string; evidence_type: string; file_hash: string; created_at: string;
  object_key: string | null; issued_by_role: string | null; meta: Record<string, unknown> | null;
}
interface Assignment { entity_id: string; nexus_id: string; name: string; role: string; trust_tier: string | null; created_at: string }
interface Detail {
  batch: Batch & { compliance_status: string; buyer_id?: string | null };
  events: DetailEvent[]; evidence: DetailEvidence[]; assignments: Assignment[]; next_gate: GateReport | null;
}

/** Every evidence type the gates know, for the holder's picker. */
const ALL_TYPES = [
  'PHOTO', 'PACKHOUSE_LOG', 'LAB_REPORT', 'LAB_RESULT', 'TRANSPORT_DOC', 'PHYTOSANITARY_CERT',
  'INSPECTION_REPORT', 'EXPORT_DECLARATION', 'CERTIFICATE_OF_ORIGIN', 'DELIVERY_NOTE',
];
/** shared/src/roles.ts REPORT_EVIDENCE_TYPES */
const OWN_REPORTS: Record<string, string[]> = { lab: ['LAB_REPORT', 'LAB_RESULT'], inspector: ['PHYTOSANITARY_CERT', 'INSPECTION_REPORT'] };
const ANALYTES = [
  { key: 'MRL', label: 'Pesticide residues (MRL)' },
  { key: 'AFLATOXIN', label: 'Aflatoxin' },
  { key: 'ETHYLENE_OXIDE', label: 'Ethylene oxide' },
];

/** What this account may do on this batch: a mirror of access.ts for showing buttons. */
function permissions(me: { id: string; role: string } | null, d: Detail) {
  const b = d.batch;
  const none = { holder: false, buyer: false, reviewer: false, signOff: false, evidenceTypes: [] as string[], any: false };
  if (!me) return none;
  const holder = b.current_holder_id === me.id;
  const buyer = me.role === 'buyer' && b.buyer_id === me.id;
  const reviewer = (me.role === 'lab' || me.role === 'inspector') && (
    d.assignments.some((a) => a.entity_id === me.id)
    || d.events.some((e) => e.actor_id === me.id)
    || d.evidence.some((e) => e.actor_id === me.id));
  const evidenceTypes = holder ? ALL_TYPES : reviewer ? OWN_REPORTS[me.role] ?? [] : [];
  const signOff = me.role === 'inspector' && reviewer;
  return { holder, buyer, reviewer, signOff, evidenceTypes, any: holder || buyer || reviewer };
}

const whoPhrase = (supplied: string[]) => {
  if (!supplied.length) return 'the current holder';
  if (supplied[0] === 'batch_buyer') return 'the named buyer';
  return supplied.map((r) => roleMeta(r).label.toLowerCase()).join(' or ');
};

function errorText(e: unknown): string {
  const data = (e as { data?: { code?: string; error?: string; gate?: GateReport } }).data;
  if (data?.code === 'GATE_FAILED' && data.gate) {
    const missing = data.gate.checklist.filter((i) => !i.satisfied).map((i) => docLabel(i.type));
    return `The gate is not met yet. Still needed: ${missing.join(', ')}.`;
  }
  return (e as Error).message || 'Something went wrong';
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function BatchDetail() {
  const { id } = useParams();
  const { data, error, isLoading } = useQuery({ queryKey: ['batch', id], queryFn: () => api<Detail>(`/batches/${id}`) });
  const title = data ? data.batch.trace_id : 'Batch';
  return (
    <DashboardLayout bare title={title}
      description={data ? <><span className="capitalize">{data.batch.commodity}</span>{data.batch.variety ? `, ${data.batch.variety}` : ''} · {Number(data.batch.quantity).toLocaleString()} {data.batch.unit} · {CORRIDORS[corridorOf(data.batch)].label}</> : undefined}
      actions={data ? (
        <Button asChild variant="outline" size="sm">
          <Link to={`/trace/${encodeURIComponent(data.batch.trace_id)}`}><ExternalLink aria-hidden /> Public trace</Link>
        </Button>
      ) : undefined}>
      {isLoading && <LoadingRows rows={5} label="Loading batch" />}
      {error && <EmptyState icon={Lock} title="Cannot open this batch" description={(error as Error).message} action={<Button asChild variant="outline"><Link to="/">Back to dashboard</Link></Button>} />}
      {data && <BatchBody detail={data} />}
    </DashboardLayout>
  );
}

function BatchBody({ detail }: { detail: Detail }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { batch } = detail;
  const meLite = me ? { id: me.id, role: me.role as string } : null;
  const can = permissions(meLite, detail);
  const { data: view } = useQuery<TraceView>({
    queryKey: ['trace', batch.trace_id],
    queryFn: () => api(`/trace/${encodeURIComponent(batch.trace_id)}`),
  });
  const proof = useBrowserProof(batch.trace_id, view, Boolean(view));
  const [queued, setQueued] = useState<number | null>(null);

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['batch', batch.id] }),
    qc.invalidateQueries({ queryKey: ['trace', batch.trace_id] }),
    qc.invalidateQueries({ queryKey: ['batches'] }),
  ]);

  /** Signed append; queued on this device when offline. */
  async function signed(record: { event_type: string; to_stage?: string; payload: Record<string, unknown> }) {
    try {
      await appendSignedEvent(batch.id, record);
    } catch (err) {
      if (!navigator.onLine) {
        await queueEvent(batch.id, record.event_type, record.payload, record.to_stage);
        setQueued(await pendingCount());
        return 'queued' as const;
      }
      throw err;
    }
    await refresh();
    return 'sent' as const;
  }

  const blocked = batch.compliance_status === 'blocked';
  const tierBySeq = useMemo(() => new Map((view?.evidence ?? []).map((e) => [e.seq, e.issuer_trust_tier])), [view]);
  const seqByEventId = useMemo(() => new Map(detail.events.map((e) => [e.id, e.seq])), [detail.events]);

  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          <StageBadge stage={batch.current_stage} />
          <ComplianceBadge status={batch.compliance_status} />
          {can.holder && <Badge variant="primary" size="sm">You hold this batch</Badge>}
          {can.buyer && <Badge variant="info" size="sm">You are the named buyer</Badge>}
          {can.reviewer && !can.holder && <Badge variant="purple" size="sm">Assigned {roleMeta(meLite?.role).label.toLowerCase()}</Badge>}
        </div>

        {blocked && (
          <p role="alert" className="rounded-xl border border-primary/40 bg-primary-soft p-3 text-sm text-primary-dark">
            This batch is blocked by a failed gate. No further events can be added until the block is cleared.
          </p>
        )}
        {queued !== null && queued > 0 && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-yellow/50 bg-brand-yellow-soft p-3 text-sm text-brand-yellow-ink">
            {queued} signed {queued === 1 ? 'event is' : 'events are'} waiting on this device until you are back online.
            <Button size="sm" variant="outline" onClick={async () => { const r = await syncQueue(); setQueued(r.remaining); await refresh(); }}>Sync now</Button>
          </div>
        )}

        <NextGateCard detail={detail} canAdvance={can.holder && !blocked} onAdvance={async (to) => {
          const r = await signed({ event_type: 'STAGE_ADVANCE', to_stage: to, payload: {} });
          toast({ variant: 'success', title: r === 'queued' ? 'Advance queued offline' : `Advanced to ${stageLabel(to)}`, description: r === 'queued' ? undefined : 'Signed on this device and added to the chain.' });
        }} />

        <ActionsCard detail={detail} can={can} blocked={blocked} signed={signed} refresh={refresh} />

        <div className="lg:hidden"><StageTimeline detail={detail} view={view} /></div>

        <EvidenceList detail={detail} tierOf={(e) => tierBySeq.get(seqByEventId.get(e.event_id) ?? -1) ?? null} />

        <CustodyCard detail={detail} view={view} meId={meLite?.id} />
      </div>

      <aside className="flex min-w-0 flex-col gap-4">
        <div className="hidden lg:block"><StageTimeline detail={detail} view={view} /></div>
        <ProofBanner proof={proof} compact />
        {view && <AnchorPanel anchors={view.anchors} proof={proof} traceId={batch.trace_id} />}
        <LabelCard detail={detail} />
      </aside>
    </div>
  );
}

/* ── Next gate ──────────────────────────────────────────────────────────── */

function NextGateCard({ detail, canAdvance, onAdvance }: { detail: Detail; canAdvance: boolean; onAdvance: (to: Stage) => Promise<void> }) {
  const gate = detail.next_gate;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!gate || !gate.to_stage) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3">
          <PackageCheck className="size-6 text-brand-green-ink" aria-hidden />
          <p className="text-sm text-ink">Delivered. This batch has passed every stage of its corridor.</p>
        </CardContent>
      </Card>
    );
  }
  const to = gate.to_stage as Stage;
  const missing = gate.checklist.filter((i) => !i.satisfied);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            Next: {stageLabel(to)}
          </CardTitle>
          {gate.pass ? <Badge variant="success" size="sm">Gate met</Badge> : <Badge variant="warning" size="sm">{missing.length} missing</Badge>}
        </div>
        <CardDescription>{gate.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {gate.checklist.length === 0 ? (gate.description ? null : <p className="text-sm text-ink-muted">No documents required for this step.</p>) : (
          <ul className="flex flex-col gap-2">
            {gate.checklist.map((it) => {
              const Icon = it.satisfied ? CircleCheck : it.problem && it.problem !== 'missing' ? CircleAlert : Circle;
              return (
                <li key={`${it.kind}-${it.type}`} className="flex items-start gap-2.5 text-sm">
                  <Icon className={cn('mt-0.5 size-5 shrink-0', it.satisfied ? 'text-brand-green-ink' : it.problem && it.problem !== 'missing' ? 'text-primary' : 'text-ink-subtle')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn('font-medium', it.satisfied ? 'text-ink-muted' : 'text-ink')}>{docLabel(it.type)}</span>
                    <span className="sr-only">{it.satisfied ? ' (on file)' : ' (missing)'}</span>
                    <span className="block text-xs text-ink-muted">
                      {it.satisfied ? 'On file' : it.problem === 'wrong_issuer' ? `On file, but this corridor needs it from the ${whoPhrase(it.supplied_by)}`
                        : it.problem === 'missing_analytes' ? `Lab report must also cover ${(it.missing_analytes ?? []).map(analyteLabel).join(', ')}`
                        : it.problem === 'no_buyer_named' ? 'No buyer is named on this batch'
                        : `Supplied by the ${whoPhrase(it.supplied_by)}`}
                    </span>
                  </span>
                  {!it.satisfied && it.supplied_by[0] && it.supplied_by[0] !== 'batch_buyer' && <RoleBadge role={it.supplied_by[0]} size="sm" showIcon={false} className="hidden sm:inline-flex" />}
                </li>
              );
            })}
          </ul>
        )}
        {error && <p role="alert" className="rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-dark">{error}</p>}
        {canAdvance ? (
          <Button block className="sm:w-auto sm:self-start" disabled={!gate.pass} loading={busy} onClick={async () => {
            setBusy(true); setError(null);
            try { await onAdvance(to); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
          }}>
            {gate.pass ? <>Sign and advance to {stageLabel(to)} <ArrowRight aria-hidden /></> : <><Lock aria-hidden /> Advance locked until the gate is met</>}
          </Button>
        ) : (
          <p className="text-xs text-ink-muted">Only the current holder can advance the batch.</p>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Actions ────────────────────────────────────────────────────────────── */

type Signed = (r: { event_type: string; to_stage?: string; payload: Record<string, unknown> }) => Promise<'sent' | 'queued'>;
type Perms = ReturnType<typeof permissions>;
type DialogKind = 'evidence' | 'assign' | 'note' | 'signoff' | 'delivery' | null;

function ActionsCard({ detail, can, blocked, signed, refresh }: { detail: Detail; can: Perms; blocked: boolean; signed: Signed; refresh: () => Promise<unknown> }) {
  const [open, setOpen] = useState<DialogKind>(null);
  const delivered = detail.events.some((e) => e.event_type === 'DELIVERY_CONFIRMED');
  const close = () => setOpen(null);

  const buttons: ReactNode[] = [];
  if (can.evidenceTypes.length) buttons.push(<Button key="ev" onClick={() => setOpen('evidence')}><FileUp aria-hidden /> Add document</Button>);
  if (can.holder) buttons.push(<HandoverButton key="ho" batch={detail.batch} size="md" />);
  if (can.holder) buttons.push(<Button key="as" variant="outline" onClick={() => setOpen('assign')}><UserPlus aria-hidden /> Assign lab or inspector</Button>);
  if (can.signOff) buttons.push(<Button key="so" variant={can.holder ? 'outline' : 'primary'} onClick={() => setOpen('signoff')}><ClipboardCheck aria-hidden /> Inspector sign-off</Button>);
  if (can.buyer && !delivered) buttons.push(<Button key="dc" onClick={() => setOpen('delivery')}><PackageCheck aria-hidden /> Confirm delivery</Button>);
  if (can.holder) buttons.push(<Button key="no" variant="ghost" onClick={() => setOpen('note')}><StickyNote aria-hidden /> Add note</Button>);

  return (
    <Card>
      <CardHeader>
        <CardTitle>What you can do</CardTitle>
        <CardDescription>Events are signed with this device's key; the private key never leaves the browser.</CardDescription>
      </CardHeader>
      <CardContent>
        {blocked ? <p className="text-sm text-ink-muted">No actions while the batch is blocked.</p>
          : buttons.length ? <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap [&>button]:w-full sm:[&>button]:w-auto">{buttons}</div>
          : <p className="text-sm text-ink-muted">You can view this batch. Actions belong to the current holder, assigned labs and inspectors, and the named buyer.</p>}
        {can.buyer && delivered && <p className="mt-3 flex items-center gap-2 text-sm text-brand-green-ink"><CircleCheck className="size-4" aria-hidden /> You confirmed delivery.</p>}
        {detail.assignments.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Assigned</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {detail.assignments.map((a) => (
                <li key={a.entity_id} className="flex flex-wrap items-center gap-2 text-sm">
                  <RoleBadge role={a.role} size="sm" />
                  <span className="font-medium text-ink">{a.name}</span>
                  <span className="font-mono text-xs text-ink-muted">{a.nexus_id}</span>
                  {a.trust_tier && <TrustBadge tier={trustTierOf({ trust_tier: a.trust_tier })} size="sm" compact />}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      {open === 'evidence' && <EvidenceDialog detail={detail} types={can.evidenceTypes} onClose={close} refresh={refresh} />}
      {open === 'assign' && <AssignDialog detail={detail} onClose={close} refresh={refresh} />}
      {open === 'note' && (
        <SignedDialog title="Add a signed note" description="Notes are part of the ledger and the public raw chain. Do not include personal data."
          field="Note" required submitLabel="Sign and add note" onClose={close}
          onSubmit={(text) => signed({ event_type: 'NOTE', payload: { text } })} />
      )}
      {open === 'signoff' && <SignOffDialog onClose={close} signed={signed} />}
      {open === 'delivery' && (
        <SignedDialog title="Confirm delivery" description="Confirm that this batch arrived. Your confirmation is signed on this device and is what the corridor's delivery gate checks."
          field="Note (optional)" submitLabel="Sign and confirm delivery" onClose={close}
          onSubmit={(note) => signed({ event_type: 'DELIVERY_CONFIRMED', payload: { confirmed: true, ...(note ? { note } : {}) } })} />
      )}
    </Card>
  );
}

function DialogError({ error }: { error: string | null }) {
  return error ? <p role="alert" className="rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-dark">{error}</p> : null;
}

function SignedDialog({ title, description, field, required, submitLabel, onClose, onSubmit }: {
  title: string; description: string; field: string; required?: boolean; submitLabel: string;
  onClose: () => void; onSubmit: (text: string) => Promise<unknown>;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setError(null);
          try { await onSubmit(text.trim()); toast({ variant: 'success', title: 'Signed and recorded' }); onClose(); }
          catch (err) { setError(errorText(err)); setBusy(false); }
        }}>
          <DialogError error={error} />
          <Field label={field} required={required}><Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} /></Field>
          <DialogFooter className="mt-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={required && !text.trim()}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SignOffDialog({ onClose, signed }: { onClose: () => void; signed: Signed }) {
  const toast = useToast();
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inspector sign-off</DialogTitle>
          <DialogDescription>Record your decision on the documents now on file. It is signed with your device key.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setError(null);
          try {
            await signed({ event_type: 'INSPECTION_SIGNOFF', payload: { decision, ...(note.trim() ? { note: note.trim() } : {}) } });
            toast({ variant: 'success', title: decision === 'approved' ? 'Approved and signed' : 'Rejection signed' });
            onClose();
          } catch (err) { setError(errorText(err)); setBusy(false); }
        }}>
          <DialogError error={error} />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-ink">Decision</legend>
            {(['approved', 'rejected'] as const).map((d) => (
              <label key={d} className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm', decision === d ? 'border-primary bg-primary-soft' : 'border-line')}>
                <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="size-4 accent-[var(--brand-primary)]" />
                {d === 'approved' ? 'Approve: documents and goods meet requirements' : 'Reject: problems found'}
              </label>
            ))}
          </fieldset>
          <Field label="Note" hint="Optional. Recorded on the ledger."><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
          <DialogFooter className="mt-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" loading={busy}>Sign decision</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ detail, onClose, refresh }: { detail: Detail; onClose: () => void; refresh: () => Promise<unknown> }) {
  const toast = useToast();
  const [nexus, setNexus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign a lab or inspector</DialogTitle>
          <DialogDescription>They can then view {detail.batch.trace_id} and add their own reports (lab reports, phytosanitary certificates).</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setError(null);
          try {
            const r = await api<{ role: string }>(`/batches/${detail.batch.id}/assignments`, { method: 'POST', body: { nexus_id: nexus.trim() } });
            toast({ variant: 'success', title: `${roleMeta(r.role).label} assigned` });
            await refresh();
            onClose();
          } catch (err) { setError(errorText(err)); setBusy(false); }
        }}>
          <DialogError error={error} />
          <Field label="Their Nexus ID" hint="For example NX-LA-1A2B3C or NX-IN-4D5E6F" required>
            <Input className="font-mono" value={nexus} onChange={(e) => setNexus(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" />
          </Field>
          <DialogFooter className="mt-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={!nexus.trim()}>Assign</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

async function sha256File(file: File): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function EvidenceDialog({ detail, types, onClose, refresh }: { detail: Detail; types: string[]; onClose: () => void; refresh: () => Promise<unknown> }) {
  const toast = useToast();
  const { me } = useAuth();
  const gate = detail.next_gate;
  // Default to the first missing item this account can supply.
  const firstMissing = gate?.checklist.find((i) => !i.satisfied && i.kind === 'evidence' && types.includes(i.type))?.type;
  const [type, setType] = useState(firstMissing ?? types[0]);
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [analytes, setAnalytes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLab = type === 'LAB_REPORT' || type === 'LAB_RESULT';
  const rule = gate?.checklist.find((i) => i.kind === 'evidence' && i.type === type);
  const wrongIssuer = rule && rule.supplied_by.length > 0 && me && !rule.supplied_by.includes(me.role);
  const needAnalytes = rule?.analytes ?? [];

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a document</DialogTitle>
          <DialogDescription>The file is fingerprinted (SHA-256) on this device. The fingerprint goes on the batch ledger; the server records you as the issuer.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={async (e) => {
          e.preventDefault();
          if (!file) { setError('Choose the document file.'); return; }
          setBusy(true); setError(null);
          try {
            const file_hash = await sha256File(file);
            const up = await api<{ upload_url: string | null; storage_enabled: boolean }>(
              `/batches/${detail.batch.id}/evidence/upload-url`, { method: 'POST', body: { file_hash, evidence_type: type } });
            let stored = false;
            if (up.storage_enabled && up.upload_url) stored = (await fetch(up.upload_url, { method: 'PUT', body: file })).ok;
            const meta: Record<string, unknown> = { file_name: file.name, size: file.size, ...(file.type ? { mime: file.type } : {}) };
            if (reference.trim()) meta.reference = reference.trim();
            if (note.trim()) meta.note = note.trim();
            if (isLab && analytes.length) meta.analytes = analytes;
            await api(`/batches/${detail.batch.id}/evidence`, { method: 'POST', body: { evidence_type: type, file_hash, meta, stored } });
            toast({ variant: 'success', title: `${docLabel(type)} added`, description: stored ? 'File stored and fingerprint recorded on the chain.' : 'Fingerprint recorded on the chain. Keep the original file.' });
            await refresh();
            onClose();
          } catch (err) { setError(errorText(err)); setBusy(false); }
        }}>
          <DialogError error={error} />
          {types.length > 1 && (
            <Field label="Document type" required>
              <Select value={type} onChange={(e) => setType(e.target.value)} options={types.map((t) => ({ value: t, label: docLabel(t) }))} />
            </Field>
          )}
          {wrongIssuer && (
            <p className="rounded-lg border border-brand-yellow/50 bg-brand-yellow-soft px-3 py-2 text-sm text-brand-yellow-ink">
              This corridor only accepts a {docLabel(type).toLowerCase()} issued by the {whoPhrase(rule!.supplied_by)}. Yours will be on file but will not meet the gate.
            </p>
          )}
          <Field label="File" hint="PDF or photo" required>
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="py-2 file:mr-3 file:rounded-md file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm file:font-semibold" />
          </Field>
          {isLab && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-ink">Tests covered by this report</legend>
              {ANALYTES.map((a) => (
                <label key={a.key} className="flex min-h-10 cursor-pointer items-center gap-3 text-sm text-ink">
                  <input type="checkbox" className="size-4 accent-[var(--brand-primary)]" checked={analytes.includes(a.key)}
                    onChange={(e) => setAnalytes((xs) => e.target.checked ? [...xs, a.key] : xs.filter((x) => x !== a.key))} />
                  {a.label}
                  {needAnalytes.includes(a.key) && <Badge size="sm">required</Badge>}
                </label>
              ))}
            </fieldset>
          )}
          <Field label="Reference number" hint="Optional, for example the certificate or report number">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Note" hint="Optional"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <DialogFooter className="mt-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" loading={busy}>{busy ? 'Recording' : 'Add document'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Timeline ───────────────────────────────────────────────────────────── */

function StageTimeline({ detail, view }: { detail: Detail; view?: TraceView }) {
  const current = STAGES.indexOf(detail.batch.current_stage as Stage);
  const corridor = corridorOf(detail.batch);
  const reachedAt = (s: string, i: number) => view?.route.find((r) => r.stage === s)?.reached_at
    ?? (i === 0 ? detail.events.find((e) => e.event_type === 'BATCH_CREATED')?.created_at
      : detail.events.find((e) => e.event_type === 'STAGE_ADVANCE' && e.to_stage === s)?.created_at);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Route</CardTitle>
        <CardDescription>{CORRIDORS[corridor].label}{view?.corridor?.destination_country ? `, to ${countryName(view.corridor.destination_country)}` : ''}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col">
          {STAGES.map((s, i) => {
            const state = i < current ? 'done' : i === current ? 'current' : i === current + 1 ? 'next' : 'later';
            const items = view?.route.find((r) => r.stage === s)?.gate?.items ?? [];
            const nextMissing = state === 'next' ? detail.next_gate?.checklist.filter((c) => !c.satisfied).length ?? 0 : 0;
            return (
              <li key={s} className="relative flex gap-3 pb-4 last:pb-0" aria-current={state === 'current' ? 'step' : undefined}>
                {i < STAGES.length - 1 && <span aria-hidden className={cn('absolute left-[11px] top-7 h-[calc(100%-1.5rem)] w-0.5', i < current ? 'bg-primary' : 'bg-line')} />}
                <span className={cn('relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold',
                  state === 'done' && 'border-primary bg-primary text-primary-fg',
                  state === 'current' && 'border-primary bg-primary-soft text-primary-dark',
                  (state === 'next' || state === 'later') && 'border-line-strong bg-surface text-ink-subtle')}>
                  {state === 'done' ? <CircleCheck className="size-3.5" aria-hidden /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-semibold', state === 'later' ? 'text-ink-muted' : 'text-ink')}>
                    {stageLabel(s)}
                    {state === 'current' && <Badge variant="primary" size="sm" className="ml-2 align-middle">Now</Badge>}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {state === 'done' || state === 'current' ? fmtDate(reachedAt(s, i))
                      : state === 'next' ? (nextMissing ? `${nextMissing} item${nextMissing === 1 ? '' : 's'} still needed` : 'Gate met, ready to advance')
                      : items.length ? `Needs ${items.map((it) => docLabel(it.type).toLowerCase()).join(', ')}` : 'No documents required'}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

/* ── Evidence ───────────────────────────────────────────────────────────── */

function EvidenceList({ detail, tierOf }: { detail: Detail; tierOf: (e: DetailEvidence) => string | null }) {
  const toast = useToast();
  async function openFile(e: DetailEvidence) {
    // Open the window first so the popup is tied to the click, then point it at the presigned URL.
    const w = window.open('', '_blank');
    try {
      const { url } = await api<{ url: string }>(`/batches/${detail.batch.id}/evidence/${e.id}/url`);
      if (w) { w.opener = null; w.location.href = url; } else window.location.href = url;
    } catch (err) {
      w?.close();
      toast({ variant: 'error', title: 'Could not open the file', description: (err as Error).message });
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents ({detail.evidence.length})</CardTitle>
        <CardDescription>The server records who issued each document; the gates check the issuer's role.</CardDescription>
      </CardHeader>
      <CardContent>
        {detail.evidence.length === 0 ? <p className="text-sm text-ink-muted">No documents yet.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {detail.evidence.map((e) => {
              const role = e.issued_by_role ?? 'unknown';
              const tier = tierOf(e);
              const meta = e.meta ?? {};
              const analytes = Array.isArray(meta.analytes) ? (meta.analytes as string[]) : [];
              return (
                <li key={e.id} className="flex flex-col rounded-lg border border-line p-3">
                  <p className="flex items-start gap-2 font-semibold text-ink"><FileText className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />{docLabel(e.evidence_type)}</p>
                  <p className="mt-1 text-xs text-ink-muted">{issuerPhrase(e.evidence_type, role, tier)} · {fmtDate(e.created_at)}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <RoleBadge role={role} size="sm" />
                    {tier && <TrustBadge tier={trustTierOf({ trust_tier: tier })} size="sm" />}
                    {analytes.map((a) => <Badge key={a} size="sm">{a.replace(/_/g, ' ')}</Badge>)}
                  </div>
                  {typeof meta.reference === 'string' && <p className="mt-2 text-xs text-ink-muted">Ref. {meta.reference}</p>}
                  <button type="button" title="Copy SHA-256" onClick={() => { void navigator.clipboard?.writeText(e.file_hash); toast({ title: 'Fingerprint copied' }); }}
                    className="mt-2 inline-flex min-h-8 items-center gap-1.5 self-start rounded bg-transparent p-0 text-left font-mono text-[11px] text-ink-muted hover:text-ink">
                    <Copy className="size-3.5 shrink-0" aria-hidden /> {e.file_hash.slice(0, 20)}…
                  </button>
                  <div className="mt-auto pt-2">
                    {e.object_key
                      ? <Button size="sm" variant="outline" onClick={() => openFile(e)}><ExternalLink aria-hidden /> View file</Button>
                      : <span className="text-xs text-ink-subtle">Fingerprint only; the file is kept by the issuer.</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Custody ────────────────────────────────────────────────────────────── */

function CustodyCard({ detail, view, meId }: { detail: Detail; view?: TraceView; meId?: string }) {
  const actorBySeq = new Map(detail.events.map((e) => [e.seq, e.actor_id]));
  const custody = view?.custody ?? [];
  const signoffs = detail.events.filter((e) => e.event_type === 'INSPECTION_SIGNOFF' || e.event_type === 'DELIVERY_CONFIRMED');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Truck className="size-5 text-ink-muted" aria-hidden /> Custody history</CardTitle>
        <CardDescription>Custody moves only by handover, signed by the party taking it.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!view ? <LoadingRows rows={2} label="Loading custody" /> : (
          <ol className="flex flex-col gap-3">
            {custody.map((c, i) => {
              const mine = meId && actorBySeq.get(c.seq) === meId;
              const isCurrent = i === custody.length - 1;
              return (
                <li key={c.seq} className="flex items-start gap-3">
                  <span className={cn('mt-1 size-2.5 shrink-0 rounded-full', isCurrent ? 'bg-primary' : 'bg-line-strong')} aria-hidden />
                  <div className="min-w-0 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <RoleBadge role={c.to_role} size="sm" />
                      {c.to_trust_tier && <TrustBadge tier={trustTierOf({ trust_tier: c.to_trust_tier })} size="sm" compact />}
                      {mine && <Badge variant="primary" size="sm">You</Badge>}
                      {isCurrent && <Badge size="sm">Current holder</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {i === 0 ? 'Created the batch' : `Took custody from ${partyPhrase(c.from_role ?? '', null).replace(/^an? /, 'the ')}`} · {fmtDate(c.at)} · event #{c.seq}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {signoffs.length > 0 && (
          <div className="border-t border-line pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Sign-offs</p>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {signoffs.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2">
                  {e.event_type === 'DELIVERY_CONFIRMED'
                    ? <><PackageCheck className="size-4 text-brand-green-ink" aria-hidden /> Buyer confirmed delivery</>
                    : <><ShieldCheck className={cn('size-4', e.payload?.decision === 'approved' ? 'text-brand-green-ink' : 'text-primary')} aria-hidden /> Inspector {String(e.payload?.decision ?? '')}</>}
                  <span className="text-xs text-ink-muted">{fmtDate(e.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── QR label ───────────────────────────────────────────────────────────── */

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function LabelCard({ detail }: { detail: Detail }) {
  const { batch } = detail;
  const url = `${location.origin}/trace/${encodeURIComponent(batch.trace_id)}`;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { width: 512, margin: 1, errorCorrectionLevel: 'M' }).then((d) => { if (live) setQr(d); });
    return () => { live = false; };
  }, [url]);
  const corridor = CORRIDORS[corridorOf(batch)];
  const lines = [
    `${batch.commodity}${batch.variety ? `, ${batch.variety}` : ''}`,
    `${Number(batch.quantity).toLocaleString()} ${batch.unit}`,
    corridorOf(batch) === 'DEFAULT' ? '' : corridor.label,
  ].filter(Boolean);

  function print() {
    if (!qr) return;
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(batch.trace_id)} label</title>
<style>
  @page { size: 62mm 90mm; margin: 4mm; }
  body { font-family: system-ui, sans-serif; margin: 0; color: #1A1A1A; }
  .label { width: 54mm; margin: 0 auto; text-align: center; border: 0.4mm solid #A81D1D; border-radius: 2mm; padding: 3mm; }
  .brand { font-weight: 800; color: #A81D1D; font-size: 9pt; letter-spacing: .08em; }
  img { width: 44mm; height: 44mm; display: block; margin: 2mm auto; image-rendering: pixelated; }
  .id { font-family: ui-monospace, Menlo, monospace; font-weight: 700; font-size: 9pt; word-break: break-all; }
  .meta { font-size: 8pt; margin-top: 1mm; }
  .meta.cap { text-transform: capitalize; }
  .hint { font-size: 7pt; margin-top: 2mm; color: #57534E; }
</style></head><body><div class="label">
<div class="brand">ATiMs TRACE</div>
<img src="${qr}" alt="QR code">
<div class="id">${escapeHtml(batch.trace_id)}</div>
${lines.map((l, i) => `<div class="meta${i === 0 ? ' cap' : ''}">${escapeHtml(l)}</div>`).join('')}
<div class="hint">Scan to verify this batch in your browser</div>
</div><script>window.onload = function () { window.print(); };</script></body></html>`);
    w.document.close();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><QrIcon className="size-5 text-ink-muted" aria-hidden /> Batch label</CardTitle>
        <CardDescription>Buyers scan this to open the public trace and verify the chain.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        <div className="w-full max-w-[15rem] rounded-xl border-2 border-primary bg-white p-3 text-center">
          <p className="text-[11px] font-extrabold tracking-widest text-primary">ATiMs TRACE</p>
          {qr ? <img src={qr} alt={`QR code linking to the public trace of ${batch.trace_id}`} className="mx-auto my-2 aspect-square w-full max-w-[11rem]" />
            : <div className="mx-auto my-2 aspect-square w-full max-w-[11rem] animate-pulse rounded bg-surface-muted" />}
          <p className="break-all font-mono text-xs font-bold text-ink">{batch.trace_id}</p>
          {lines.map((l, i) => <p key={l} className={cn('text-[11px] text-ink-muted', i === 0 && 'capitalize')}>{l}</p>)}
        </div>
        <div className="flex w-full flex-wrap justify-center gap-2">
          <Button size="sm" onClick={print} disabled={!qr}><Printer aria-hidden /> Print label</Button>
          {qr && <Button asChild size="sm" variant="outline"><a href={qr} download={`${batch.trace_id}-qr.png`}>Download PNG</a></Button>}
        </div>
        <p className="break-all text-center font-mono text-[11px] text-ink-subtle">{url}</p>
      </CardContent>
    </Card>
  );
}

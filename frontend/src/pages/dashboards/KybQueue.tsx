import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ShieldOff, UserSearch } from 'lucide-react';
import { api } from '../../lib/api';
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Field, LoadingRows,
  ResponsiveTable, RoleBadge, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, TrustBadge, trustTierOf, useToast,
} from '../../components/ui';

export interface EntityRow {
  id: string; nexus_id: string; name: string; role: string; status: string; trust_tier: string;
  email: string | null; phone: string | null; profile: Record<string, unknown> | null;
  state_province: string | null; country: string | null; email_verified_at: string | null;
  kyb_verified_at: string | null; created_at: string; verified_by_nexus_id: string | null; verified_by_role: string | null;
}

const TIERS = [
  { tier: 'self_verified', label: 'Awaiting KYB', empty: 'No self-verified accounts waiting for review.' },
  { tier: 'registered', label: 'Email not confirmed', empty: 'No accounts waiting on an email code.' },
  { tier: 'kyb_verified', label: 'KYB verified', empty: 'No KYB-verified accounts yet.' },
] as const;

export function useEntities(tier: string) {
  return useQuery({
    queryKey: ['entities', tier],
    queryFn: () => api<{ entities: EntityRow[] }>(`/entities?trust_tier=${tier}`),
    select: (d) => d.entities,
  });
}

/**
 * KYB review queue (GET /entities, POST /entities/:id/kyb). Admins review every
 * role; KYB-verified inspectors review farmers (the API scopes the list).
 */
export function KybQueue({ scope }: { scope: 'all' | 'farmers' }) {
  const [tab, setTab] = useState<string>('self_verified');
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label="Accounts by trust tier">
        {TIERS.map((t) => <TabsTrigger key={t.tier} value={t.tier}>{t.label}</TabsTrigger>)}
      </TabsList>
      {TIERS.map((t) => (
        <TabsContent key={t.tier} value={t.tier}>
          {tab === t.tier && <TierList tier={t.tier} empty={t.empty} scope={scope} />}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function TierList({ tier, empty, scope }: { tier: string; empty: string; scope: 'all' | 'farmers' }) {
  const { data = [], isLoading, error } = useEntities(tier);
  const [open, setOpen] = useState<EntityRow | null>(null);
  if (isLoading) return <LoadingRows rows={3} label="Loading accounts" />;
  if (error) return <p role="alert" className="text-sm text-primary-dark">{(error as Error).message}</p>;
  const rows = data.filter((e) => e.role !== 'admin');
  return (
    <>
      <ResponsiveTable<EntityRow> caption="Accounts" rows={rows} rowKey={(e) => e.id}
        empty={<EmptyState icon={UserSearch} title={empty} />}
        columns={[
          { key: 'n', header: 'Account', primary: true, cell: (e) => (
            <span className="inline-flex min-w-0 flex-col">
              <span className="truncate">{e.name}</span>
              <span className="font-mono text-xs font-normal text-ink-muted">{e.nexus_id}</span>
            </span>) },
          ...(scope === 'all' ? [{ key: 'r', header: 'Role', cell: (e: EntityRow) => <RoleBadge role={e.role} size="sm" /> }] : []),
          { key: 'e', header: 'Email', hideOnMobile: true, cell: (e) => e.email ?? 'None (legacy account)' },
          { key: 'd', header: 'Registered', cell: (e) => new Date(e.created_at).toLocaleDateString() },
          { key: 't', header: 'Trust', cell: (e) => <TrustBadge tier={trustTierOf(e)} size="sm" /> },
        ]}
        rowAction={(e) => <Button size="sm" variant="outline" onClick={() => setOpen(e)}>Review</Button>} />
      {open && <ReviewDialog entity={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'Not given';
  if (Array.isArray(v)) return v.map(fmt).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('lat' in o && 'lng' in o) return `${o.lat}, ${o.lng}`;
    return Object.entries(o).map(([k, x]) => `${label(k)}: ${fmt(x)}`).join('; ');
  }
  return String(v);
}
const label = (k: string) => ({
  cac_number: 'CAC number', nepc_number: 'NEPC number', tin: 'TIN', lga: 'LGA', farm_gps: 'Farm GPS', farm_size_ha: 'Farm size (ha)',
  iso17025_accreditation_number: 'ISO 17025 number', staff_id: 'Staff ID', warehouse_location: 'Warehouse', gps: 'GPS',
}[k] ?? k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));

function ReviewDialog({ entity, onClose }: { entity: EntityRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'revoke') =>
      api(`/entities/${entity.id}/kyb`, { method: 'POST', body: { decision, ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: (_d, decision) => {
      toast({ variant: 'success', title: decision === 'approve' ? `${entity.name} is KYB verified` : `KYB removed from ${entity.name}` });
      void qc.invalidateQueries({ queryKey: ['entities'] });
      onClose();
    },
  });
  const isVerified = entity.trust_tier === 'kyb_verified';
  const gps = (entity.profile?.farm_gps ?? (entity.profile?.warehouse_location as Record<string, unknown> | undefined)?.gps) as { lat?: number; lng?: number } | undefined;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entity.name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{entity.nexus_id}</span>
            <RoleBadge role={entity.role} size="sm" />
            <TrustBadge tier={trustTierOf(entity)} size="sm" />
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
          <Item k="Email" v={entity.email ? `${entity.email}${entity.email_verified_at ? ' (confirmed)' : ' (not confirmed)'}` : 'None'} />
          {entity.phone && <Item k="Phone" v={entity.phone} />}
          {Object.entries(entity.profile ?? {}).filter(([k]) => k !== 'phone').map(([k, v]) => <Item key={k} k={label(k)} v={fmt(v)} />)}
          {entity.verified_by_nexus_id && <Item k="Verified by" v={`${entity.verified_by_nexus_id} (${entity.verified_by_role})`} />}
        </dl>
        {gps?.lat !== undefined && gps.lng !== undefined && (
          <a className="mt-3 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline" target="_blank" rel="noreferrer"
            href={`https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lng}#map=14/${gps.lat}/${gps.lng}`}>View location on a map</a>
        )}
        <p className="mt-4 text-xs text-ink-muted">
          Approve only after checking the documents behind these numbers (for example the CAC certificate or a farm visit).
          Your Nexus ID is recorded as the verifier.
        </p>
        <Field label="Note" hint="Optional, kept in the audit log" className="mt-3">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {decide.error && <p role="alert" className="mt-3 text-sm text-primary-dark">{(decide.error as Error).message}</p>}
        <DialogFooter>
          {isVerified
            ? <Button variant="danger" loading={decide.isPending} onClick={() => decide.mutate('revoke')}><ShieldOff aria-hidden /> Revoke KYB</Button>
            : <Button loading={decide.isPending} onClick={() => decide.mutate('approve')}><BadgeCheck aria-hidden /> Approve KYB</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{k}</dt>
      <dd className="break-words text-ink">{v}</dd>
    </div>
  );
}

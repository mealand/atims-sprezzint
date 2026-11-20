import { Link } from 'react-router-dom';
import { FileWarning, Ship, Boxes, ScanLine, CircleCheck } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useAuth } from '../../lib/auth';
import { Badge, Button, EmptyState, ResponsiveTable, StatCard } from '../../components/ui';
import { checklist, corridorOf, type ChecklistItem } from './requirements';
import {
  BatchList, CorridorBadge, CorridorPipeline, EvidenceButton, HandoverButton, Section, StageBadge, StatGrid, WelcomeBanner,
  holds, isActive, useBatchDetails, useBatches, type Batch,
} from './shared';

const EXPORTER_DOCS = ['EXPORT_DECLARATION', 'CERTIFICATE_OF_ORIGIN', 'TRANSPORT_DOC', 'PHOTO'];

/** Exporter: pipeline by corridor, missing export documents. */
export default function ExporterDashboard() {
  const { me } = useAuth();
  const { data: batches = [], isLoading } = useBatches();
  const held = batches.filter((b) => holds(b, me?.id) && isActive(b) && b.current_stage !== 'EXPORTED');
  const { details, loading } = useBatchDetails(held.slice(0, 12).map((b) => b.id));

  const rows = held.slice(0, 12).map((b) => {
    const d = details.get(b.id);
    const items: ChecklistItem[] | null = d ? checklist(corridorOf(b), 'EXPORTED', d.evidence, d.events) : null;
    return { batch: b, missing: items?.filter((i) => !i.done) ?? null };
  });
  const missingCount = rows.reduce((n, r) => n + (r.missing?.length ?? 0), 0);

  return (
    <DashboardLayout bare title="Export pipeline" description={me?.name}
      actions={<Button asChild><Link to="/handover/accept"><ScanLine aria-hidden /> Receive a batch</Link></Button>}>
      <WelcomeBanner />
      <StatGrid>
        <StatCard label="Batches visible" value={batches.length} icon={Boxes} accent="var(--brand-blue)" />
        <StatCard label="In my custody" value={held.length} icon={Ship} accent="var(--brand-purple)" />
        <StatCard label="Missing documents" value={loading ? '…' : missingCount} icon={FileWarning} accent="var(--brand-yellow)" />
        <StatCard label="Exported" value={batches.filter((b) => ['EXPORTED', 'DELIVERED'].includes(b.current_stage)).length} icon={CircleCheck} accent="var(--brand-green)" />
      </StatGrid>

      <Section title="Pipeline by corridor" description="Every batch you can see, by trade corridor and stage.">
        <CorridorPipeline batches={batches} />
      </Section>

      <Section title="Missing export documents" description="What each batch in your custody still needs for export clearance, and who must supply it.">
        <ResponsiveTable<{ batch: Batch; missing: ChecklistItem[] | null }>
          caption="Missing export documents" rows={rows} rowKey={(r) => r.batch.id}
          empty={<EmptyState icon={Ship} title="No batches waiting for export" description="Batches you receive by handover appear here with their export checklist." />}
          columns={[
            { key: 'b', header: 'Batch', primary: true, cell: (r) => (
              <Link to={`/batches/${r.batch.id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{r.batch.trace_id}</Link>) },
            { key: 'c', header: 'Corridor', cell: (r) => <CorridorBadge batch={r.batch} /> },
            { key: 's', header: 'Stage', cell: (r) => <StageBadge stage={r.batch.current_stage} /> },
            { key: 'm', header: 'Missing', cell: (r) => r.missing === null ? <span className="text-ink-muted">Checking</span>
              : r.missing.length === 0 ? <Badge variant="success" size="sm">All on file</Badge>
              : (
                <ul className="flex flex-col gap-0.5 whitespace-normal">
                  {r.missing.map((m) => <li key={m.type} className="text-sm">{m.label} <span className="text-xs text-ink-muted">({m.supplier})</span></li>)}
                </ul>
              ) },
          ]}
          rowAction={(r) => (
            <div className="flex flex-wrap justify-end gap-2">
              <EvidenceButton batch={r.batch} types={EXPORTER_DOCS} label="Add" />
              <HandoverButton batch={r.batch} />
            </div>
          )} />
      </Section>

      <Section title="All batches">
        <BatchList batches={batches} loading={isLoading} caption="All visible batches"
          extra={[{ key: 'corr', header: 'Corridor', cell: (b) => <CorridorBadge batch={b} /> }]}
          empty={<EmptyState icon={Boxes} title="No batches yet" description="Batches you receive or are named on appear here." />} />
      </Section>
    </DashboardLayout>
  );
}

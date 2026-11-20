import { Boxes, CircleCheck, ShieldAlert, Clock, Eye } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useAuth } from '../../lib/auth';
import { Badge, EmptyState, StatCard } from '../../components/ui';
import { BatchList, CorridorBadge, CorridorPipeline, Section, StatGrid, WelcomeBanner, useBatches } from './shared';

/** Regulator: read-only overview of every corridor and batch. */
export default function RegulatorDashboard() {
  const { me } = useAuth();
  const { data: batches = [], isLoading } = useBatches();
  const count = (s: string) => batches.filter((b) => b.compliance_status === s).length;

  return (
    <DashboardLayout bare title="Corridor oversight" description={me?.name}
      actions={<Badge variant="info"><Eye aria-hidden /> Read-only</Badge>}>
      <WelcomeBanner />
      <StatGrid>
        <StatCard label="All batches" value={batches.length} icon={Boxes} accent="var(--brand-blue)" />
        <StatCard label="Compliant" value={count('compliant')} icon={CircleCheck} accent="var(--brand-green)" />
        <StatCard label="Pending" value={count('pending')} icon={Clock} accent="var(--brand-yellow)" />
        <StatCard label="Blocked" value={count('blocked')} icon={ShieldAlert} accent="var(--brand-primary)" />
      </StatGrid>
      <Section title="Corridors" description="Batches by trade corridor and supply-chain stage.">
        <CorridorPipeline batches={batches} />
      </Section>
      <Section title="All batches" description="Open a batch to see its ledger, evidence and gate history.">
        <BatchList batches={batches} loading={isLoading} caption="All batches"
          extra={[
            { key: 'corr', header: 'Corridor', cell: (b) => <CorridorBadge batch={b} /> },
            { key: 'dest', header: 'Destination', hideOnMobile: true, cell: (b) => b.destination_country ?? 'Not set' },
          ]}
          empty={<EmptyState icon={Boxes} title="No batches recorded yet" />} />
      </Section>
    </DashboardLayout>
  );
}

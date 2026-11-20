import { BadgeCheck, MailWarning, UserCheck, Boxes } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { StatCard } from '../../components/ui';
import { CorridorPipeline, Section, StatGrid, useBatches } from './shared';
import { KybQueue, useEntities } from './KybQueue';

/** Admin: KYB review queue plus a platform overview. */
export default function AdminDashboard() {
  const awaiting = useEntities('self_verified');
  const unconfirmed = useEntities('registered');
  const verified = useEntities('kyb_verified');
  const { data: batches = [] } = useBatches();
  const n = (q: { data?: unknown[] }) => q.data?.length ?? '…';

  return (
    <DashboardLayout bare title="Administration" description="Business verification (KYB) and platform overview.">
      <StatGrid>
        <StatCard label="Awaiting KYB" value={n(awaiting)} icon={UserCheck} accent="var(--brand-yellow)" hint="Self-verified, can already act" />
        <StatCard label="Email not confirmed" value={n(unconfirmed)} icon={MailWarning} accent="var(--brand-blue)" />
        <StatCard label="KYB verified" value={n(verified)} icon={BadgeCheck} accent="var(--brand-green)" />
        <StatCard label="Batches" value={batches.length} icon={Boxes} accent="var(--brand-purple)" />
      </StatGrid>
      <Section title="KYB review queue" description="Self-verified accounts already work. KYB raises their trust badge once you have checked their documents.">
        <KybQueue scope="all" />
      </Section>
      <Section title="Corridors">
        <CorridorPipeline batches={batches} />
      </Section>
    </DashboardLayout>
  );
}

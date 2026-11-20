import { Link } from 'react-router-dom';
import { ClipboardCheck, FlaskConical, Clock, CircleCheck } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useAuth } from '../../lib/auth';
import { Badge, StatCard, trustTierOf, ResponsiveTable } from '../../components/ui';
import { docLabel } from './requirements';
import {
  BatchList, CorridorBadge, EvidenceButton, NexusIdHint, Section, StageBadge, StatGrid, WelcomeBanner,
  useBatchDetails, useBatches, type Batch, type BatchDetail,
} from './shared';
import { KybQueue } from './KybQueue';

const REPORTS = {
  lab: ['LAB_REPORT', 'LAB_RESULT'],
  inspector: ['PHYTOSANITARY_CERT', 'INSPECTION_REPORT'],
} as const;

/**
 * Lab (test requests, upload results) and inspector (sign-off queue). Both see
 * the batches they are assigned to or have already reported on.
 */
export default function ReviewerDashboard({ role }: { role: 'lab' | 'inspector' }) {
  const { me } = useAuth();
  const { data: batches = [], isLoading } = useBatches();
  const { details, loading } = useBatchDetails(batches.slice(0, 30).map((b) => b.id));
  const types = REPORTS[role];
  const mine = (d?: BatchDetail) => (d?.evidence ?? []).filter((e) => e.actor_id === me?.id && (types as readonly string[]).includes(e.evidence_type));

  const pending = batches.filter((b) => b.current_stage !== 'DELIVERED' && details.has(b.id) && mine(details.get(b.id)).length === 0);
  const done = batches.filter((b) => mine(details.get(b.id)).length > 0);
  const isLab = role === 'lab';
  const canReviewFarmers = role === 'inspector' && trustTierOf(me as { trust_tier?: string; status?: string }) === 'kyb_verified';

  return (
    <DashboardLayout bare title={isLab ? 'Lab workbench' : 'Inspection queue'} description={me?.name}>
      <WelcomeBanner />
      <StatGrid>
        <StatCard label={isLab ? 'Test requests' : 'Awaiting sign-off'} value={loading ? '…' : pending.length} icon={Clock} accent="var(--brand-yellow)" />
        <StatCard label={isLab ? 'Results submitted' : 'Signed off'} value={loading ? '…' : done.length} icon={CircleCheck} accent="var(--brand-green)" />
        <StatCard label="Assigned batches" value={batches.length} icon={isLab ? FlaskConical : ClipboardCheck} accent="var(--brand-purple)" />
      </StatGrid>

      <Section title={isLab ? 'Test requests' : 'Sign-off queue'}
        description={isLab
          ? 'Batches assigned to your lab that have no result from you yet. EU sesame needs MRL, aflatoxin and ethylene oxide results.'
          : 'Batches assigned to you that have no phytosanitary certificate or inspection report from you yet.'}>
        <ResponsiveTable<Batch> caption={isLab ? 'Test requests' : 'Sign-off queue'} rows={pending} rowKey={(b) => b.id}
          empty={isLoading || loading ? null : <NexusIdHint what={isLab ? 'test requests' : 'batches to inspect'} />}
          columns={[
            { key: 'b', header: 'Batch', primary: true, cell: (b) => (
              <Link to={`/batches/${b.id}`} className="inline-flex flex-col">
                <span className="font-mono text-sm font-semibold text-primary hover:underline">{b.trace_id}</span>
                <span className="text-xs font-normal text-ink-muted">{b.commodity}, {Number(b.quantity).toLocaleString()} {b.unit}</span>
              </Link>) },
            { key: 'c', header: 'Corridor', cell: (b) => <CorridorBadge batch={b} /> },
            { key: 's', header: 'Stage', cell: (b) => <StageBadge stage={b.current_stage} /> },
            { key: 'o', header: 'Origin', hideOnMobile: true, cell: (b) => b.origin_state ?? 'Not given' },
          ]}
          rowAction={(b) => <EvidenceButton batch={b} types={[...types]} label={isLab ? 'Upload result' : 'Sign off'} />} />
      </Section>

      {done.length > 0 && (
        <Section title={isLab ? 'Results submitted' : 'Signed off'}>
          <BatchList batches={done} caption={isLab ? 'Results submitted' : 'Signed off'} empty={null}
            extra={[{ key: 'r', header: 'Your reports', cell: (b) => (
              <span className="flex flex-wrap gap-1">{mine(details.get(b.id)).map((e) => <Badge key={e.id} size="sm" variant="success">{docLabel(e.evidence_type)}</Badge>)}</span>
            ) }]} />
        </Section>
      )}

      {canReviewFarmers && (
        <Section title="Farmer verification" description="As a KYB-verified inspector you can verify farmers you have visited.">
          <KybQueue scope="farmers" />
        </Section>
      )}
    </DashboardLayout>
  );
}

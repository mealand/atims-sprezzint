import { Link } from 'react-router-dom';
import { Boxes, PackageCheck, ScanLine, Inbox, ShieldAlert } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useAuth } from '../../lib/auth';
import { Button, Card, CardContent, EmptyState, StatCard, roleMeta } from '../../components/ui';
import {
  BatchList, EvidenceButton, HandoverButton, NextGateCard, Section, StatGrid, WelcomeBanner, holds, isActive, useBatchDetails, useBatches,
} from './shared';

const PRE_PACK = ['HARVESTED', 'AGGREGATED'];

/** Aggregator and processor: incoming handovers, batches to pack. */
export default function HandlerDashboard({ role }: { role: 'aggregator' | 'processor' }) {
  const { me } = useAuth();
  const { data: batches = [], isLoading } = useBatches();
  const held = batches.filter((b) => holds(b, me?.id) && isActive(b));
  const received = held.filter((b) => b.origin_entity_id !== me?.id);
  const toPack = held.filter((b) => PRE_PACK.includes(b.current_stage));
  const { details } = useBatchDetails(toPack.slice(0, 6).map((b) => b.id));
  const label = roleMeta(role).label;

  return (
    <DashboardLayout bare title={`${label} dashboard`} description={me?.name}
      actions={<Button asChild><Link to="/handover/accept"><ScanLine aria-hidden /> Receive a batch</Link></Button>}>
      <WelcomeBanner />
      <StatGrid>
        <StatCard label="In my custody" value={held.length} icon={Boxes} accent="var(--brand-blue)" />
        <StatCard label="To pack" value={toPack.length} icon={PackageCheck} accent="var(--brand-yellow)" />
        <StatCard label="Received" value={received.length} icon={Inbox} accent="var(--brand-green)" />
        <StatCard label="Blocked" value={held.filter((b) => b.compliance_status === 'blocked').length} icon={ShieldAlert} accent="var(--brand-primary)" />
      </StatGrid>

      <Section title="Incoming handovers" description="Scan the QR code the current holder shows you to take custody.">
        <Card>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary" aria-hidden><ScanLine className="size-5.5" /></span>
              <div>
                <p className="font-semibold text-ink">Receiving produce?</p>
                <p className="text-sm text-ink-muted">Ask the farmer or supplier to open the batch and tap Hand over, then scan their code.</p>
              </div>
            </div>
            <Button asChild size="lg" className="shrink-0"><Link to="/handover/accept"><ScanLine aria-hidden /> Scan handover code</Link></Button>
          </CardContent>
        </Card>
        {received.length > 0 && (
          <div className="mt-3">
            <BatchList batches={received.slice(0, 5)} caption="Recently received" empty={null} />
          </div>
        )}
      </Section>

      <Section title="Batches to pack" description="Packing needs these documents before the batch can move to Packed.">
        {toPack.length === 0
          ? <EmptyState icon={PackageCheck} title="Nothing waiting to pack" description="Batches you receive before packing show up here with their checklist." />
          : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {toPack.slice(0, 6).map((b) => (
                <NextGateCard key={b.id} batch={b} detail={details.get(b.id)} stage="PACKED"
                  footer={<>
                    <EvidenceButton batch={b} types={['PACKHOUSE_LOG', 'PHOTO']} label="Add packing record" />
                    <Button asChild size="sm" variant="outline"><Link to={`/batches/${b.id}`}>Open</Link></Button>
                  </>} />
              ))}
            </div>
          )}
      </Section>

      <Section title="All batches in my custody">
        <BatchList batches={held} loading={isLoading} caption="Batches in my custody"
          action={(b) => <HandoverButton batch={b} />}
          empty={<EmptyState icon={Boxes} title="No batches in your custody" description="Accept a handover to start." />} />
      </Section>
    </DashboardLayout>
  );
}

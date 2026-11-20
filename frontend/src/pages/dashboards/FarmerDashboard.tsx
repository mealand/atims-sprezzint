import { Link } from 'react-router-dom';
import { CirclePlus, Package, Truck, ShieldAlert, Sprout } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useAuth } from '../../lib/auth';
import { Button, EmptyState, StatCard } from '../../components/ui';
import {
  BatchList, EvidenceButton, HandoverButton, NextGateCard, Section, StatGrid, WelcomeBanner, holds, isActive, useBatchDetails, useBatches,
} from './shared';

/** Farmer: my batches, next gate checklist, create batch, hand over. */
export default function FarmerDashboard() {
  const { me } = useAuth();
  const { data: batches = [], isLoading } = useBatches();
  const held = batches.filter((b) => holds(b, me?.id) && isActive(b));
  const focus = held.slice(0, 3);
  const { details } = useBatchDetails(focus.map((b) => b.id));
  const mine = batches.filter((b) => b.origin_entity_id === me?.id);

  return (
    <DashboardLayout bare title={`Welcome, ${me?.name ?? ''}`} description="Your harvests, from farm gate to handover."
      actions={<Button asChild><Link to="/create-batch"><CirclePlus aria-hidden /> New batch</Link></Button>}>
      <WelcomeBanner />
      <StatGrid>
        <StatCard label="My batches" value={mine.length} icon={Sprout} accent="var(--brand-green)" />
        <StatCard label="With me now" value={held.length} icon={Package} accent="var(--brand-blue)" />
        <StatCard label="Handed over" value={mine.filter((b) => !holds(b, me?.id)).length} icon={Truck} accent="var(--brand-purple)" />
        <StatCard label="Blocked" value={batches.filter((b) => b.compliance_status === 'blocked').length} icon={ShieldAlert} accent="var(--brand-primary)" />
      </StatGrid>

      {focus.length > 0 && (
        <Section title="Next gate" description="What each batch still needs before it can move on.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {focus.map((b) => (
              <NextGateCard key={b.id} batch={b} detail={details.get(b.id)}
                footer={<>
                  <EvidenceButton batch={b} types={['PHOTO', 'TRANSPORT_DOC', 'DELIVERY_NOTE']} label="Add photo or document" variant="outline" />
                  <HandoverButton batch={b} variant="primary" />
                </>} />
            ))}
          </div>
        </Section>
      )}

      <Section title="My batches" action={<Button asChild size="sm" variant="outline"><Link to="/create-batch"><CirclePlus aria-hidden /> Create batch</Link></Button>}>
        <BatchList batches={batches} loading={isLoading} caption="My batches"
          action={(b) => (holds(b, me?.id) && isActive(b) ? <HandoverButton batch={b} /> : null)}
          empty={<EmptyState icon={Sprout} title="No batches yet"
            description="Record your first harvest. It gets a trace ID and a QR code buyers can check."
            action={<Button asChild><Link to="/create-batch"><CirclePlus aria-hidden /> Create your first batch</Link></Button>} />} />
      </Section>
    </DashboardLayout>
  );
}

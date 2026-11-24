import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PackageCheck, ShieldCheck, ShoppingBag, Truck, Settings as SettingsIcon } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useAuth } from '../../lib/auth';
import { appendSignedEvent } from '../../lib/events';
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Field, StatCard, Textarea, useToast,
} from '../../components/ui';
import { BatchList, CorridorBadge, Section, StatGrid, WelcomeBanner, holds, useBatches, type Batch } from './shared';

/** Buyer: inbound batches, verify each one, confirm delivery. */
export default function BuyerDashboard() {
  const { me } = useAuth();
  const { data: batches = [], isLoading } = useBatches();
  const inbound = batches.filter((b) => b.current_stage !== 'DELIVERED');
  const delivered = batches.filter((b) => b.current_stage === 'DELIVERED');

  return (
    <DashboardLayout bare title="Inbound shipments" description={me?.name}
      actions={<Button asChild variant="outline"><Link to="/settings"><SettingsIcon aria-hidden /> Settings</Link></Button>}>
      <WelcomeBanner />
      <StatGrid>
        <StatCard label="Inbound" value={inbound.length} icon={Truck} accent="var(--brand-blue)" />
        <StatCard label="With you" value={batches.filter((b) => holds(b, me?.id)).length} icon={ShoppingBag} accent="var(--brand-purple)" />
        <StatCard label="Delivered" value={delivered.length} icon={PackageCheck} accent="var(--brand-green)" />
      </StatGrid>

      <Section title="Inbound batches" description="Batches that name you as buyer, or that you have received.">
        <BatchList batches={inbound} loading={isLoading} caption="Inbound batches"
          extra={[{ key: 'corr', header: 'Corridor', cell: (b) => <CorridorBadge batch={b} /> }]}
          action={(b) => <BuyerActions batch={b} />}
          empty={<EmptyState icon={ShoppingBag} title="No inbound batches yet"
            description={<>Exporters name you on a batch by your Nexus ID <span className="font-mono font-semibold text-ink">{me?.nexus_id}</span>. You can verify any batch from its QR code without waiting.</>}
            action={<Button asChild variant="outline"><Link to="/trace"><ShieldCheck aria-hidden /> Verify a batch</Link></Button>} />} />
      </Section>

      {delivered.length > 0 && (
        <Section title="Delivered">
          <BatchList batches={delivered} caption="Delivered batches" empty={null}
            action={(b) => <Button asChild size="sm" variant="outline"><Link to={`/trace/${encodeURIComponent(b.trace_id)}`}><ShieldCheck aria-hidden /> Verify</Link></Button>} />
        </Section>
      )}
    </DashboardLayout>
  );
}

function BuyerActions({ batch }: { batch: Batch }) {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  // The server accepts DELIVERY_CONFIRMED only from the buyer named on the batch.
  const canConfirm = Boolean(me?.id) && batch.buyer_id === me?.id;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button asChild size="sm" variant="outline">
        <Link to={`/trace/${encodeURIComponent(batch.trace_id)}`}><ShieldCheck aria-hidden /> Verify</Link>
      </Button>
      {canConfirm && <Button size="sm" onClick={() => setOpen(true)}><PackageCheck aria-hidden /> Confirm delivery</Button>}
      {open && <ConfirmDeliveryDialog batch={batch} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Appends a signed DELIVERY_CONFIRMED event (device key) to the batch chain. */
function ConfirmDeliveryDialog({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true); setError(null);
    try {
      await appendSignedEvent(batch.id, {
        event_type: 'DELIVERY_CONFIRMED',
        payload: { confirmed_by: me?.nexus_id, received_at: new Date().toISOString(), ...(note.trim() ? { note: note.trim() } : {}) },
      });
      toast({ variant: 'success', title: 'Delivery confirmed', description: `Signed with your device key and added to ${batch.trace_id}.` });
      await qc.invalidateQueries({ queryKey: ['batches'] });
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      // Servers without corridor support (task T4) do not accept DELIVERY_CONFIRMED yet and answer 500.
      setError(!msg || msg === 'Internal Server Error'
        ? 'This server cannot record delivery confirmations yet. Nothing was saved; please try again after the next update.'
        : msg.charAt(0).toUpperCase() + msg.slice(1));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm delivery of {batch.trace_id}</DialogTitle>
          <DialogDescription>
            This records that you received {batch.commodity} ({Number(batch.quantity).toLocaleString()} {batch.unit}). It is signed on this device and cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="mb-3 rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-dark">{error}</p>}
        <Field label="Note" hint="Optional, for example the condition on arrival">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={confirm} loading={busy}>Confirm delivery</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

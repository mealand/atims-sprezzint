import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Sprout } from 'lucide-react';
import { NIGERIAN_STATES } from '@atims/shared';
import { api } from '../../lib/api';
import DashboardLayout from '../../components/DashboardLayout';
import { Button, Card, CardContent, Field, Input, Select, Textarea } from '../../components/ui';
import { CORRIDORS, requirementsFor, docLabel, type CorridorId } from './requirements';
import { useMe } from './shared';

const EU_COUNTRIES: Array<[string, string]> = [
  ['NL', 'Netherlands'], ['DE', 'Germany'], ['BE', 'Belgium'], ['FR', 'France'], ['IT', 'Italy'], ['ES', 'Spain'],
  ['GR', 'Greece'], ['PL', 'Poland'], ['PT', 'Portugal'], ['IE', 'Ireland'],
];
const COMMODITIES = ['Sesame', 'Cashew', 'Cocoa', 'Ginger', 'Hibiscus', 'Shea', 'Soybean', 'Groundnut'];
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Create a batch (POST /batches). The corridor is sent so the API can scope
 * the stage gates to it once corridor support is live; today's API ignores
 * unknown fields, so the batch then follows the default rules.
 */
export default function CreateBatch() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const [corridor, setCorridor] = useState<CorridorId>('NG-EU-SESAME');
  const [form, setForm] = useState({
    commodity: 'Sesame', variety: '', quantity: '', unit: 'kg', production_date: today(),
    origin_state: '', destination_country: 'NL', notes: '', buyer_nexus_id: '',
  });
  const buyerRequired = corridor === 'NG-AE-SESAME';
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const st = (me?.profile as { state?: string } | undefined)?.state ?? me?.state_province;
    if (st) setForm((f) => (f.origin_state ? f : { ...f, origin_state: st }));
  }, [me]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function chooseCorridor(c: CorridorId) {
    setCorridor(c);
    setForm((f) => ({
      ...f,
      commodity: c === 'DEFAULT' ? f.commodity : 'Sesame',
      destination_country: c === 'NG-AE-SESAME' ? 'AE' : c === 'NG-EU-SESAME' ? (EU_COUNTRIES.some(([k]) => k === f.destination_country) ? f.destination_country : 'NL') : f.destination_country,
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const quantity = Number(form.quantity);
    if (!form.commodity.trim()) { setError('Choose a commodity.'); return; }
    if (!Number.isFinite(quantity) || quantity <= 0) { setError('Enter a quantity greater than zero.'); return; }
    const buyer = form.buyer_nexus_id.trim().toUpperCase();
    if (buyerRequired && !buyer) { setError(`${CORRIDORS[corridor].label} needs the buyer named now: enter the buyer's Nexus ID.`); return; }
    setBusy(true); setError(null);
    try {
      const d = await api<{ batch: { id: string } }>('/batches', {
        method: 'POST',
        body: {
          commodity: form.commodity.trim(), variety: form.variety.trim() || undefined, quantity, unit: form.unit,
          production_date: form.production_date, origin_state: form.origin_state || undefined,
          destination_country: form.destination_country.trim().toUpperCase() || undefined, notes: form.notes.trim() || undefined,
          ...(corridor !== 'DEFAULT' ? { corridor } : {}),
          ...(buyer ? { buyer_nexus_id: buyer } : {}),
        },
      });
      nav(`/batches/${d.batch.id}`);
    } catch (err) {
      setError((err as Error).message || 'Could not create the batch');
      setBusy(false);
    }
  }

  const packed = requirementsFor(corridor, 'PACKED');
  const exported = requirementsFor(corridor, 'EXPORTED');

  return (
    <DashboardLayout bare title="New batch" description="Record a harvest. It gets a trace ID and its first ledger entry."
      actions={<Button asChild variant="outline"><Link to="/"><ArrowLeft aria-hidden /> Dashboard</Link></Button>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
              {error && <p role="alert" className="rounded-lg bg-primary-soft px-4 py-3 text-sm font-medium text-primary-dark">{error}</p>}
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink">Trade corridor</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(['NG-EU-SESAME', 'NG-AE-SESAME', 'DEFAULT'] as CorridorId[]).map((c) => (
                    <label key={c} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                      <input type="radio" name="corridor" value={c} checked={corridor === c} onChange={() => chooseCorridor(c)} className="accent-[var(--brand-primary)]" />
                      <span className="font-medium text-ink">{c === 'DEFAULT' ? 'Other' : CORRIDORS[c].label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Commodity" required>
                  {corridor === 'DEFAULT'
                    ? <Input list="commodities" value={form.commodity} onChange={set('commodity')} />
                    : <Input value="Sesame" readOnly aria-readonly />}
                </Field>
                <datalist id="commodities">{COMMODITIES.map((c) => <option key={c} value={c} />)}</datalist>
                <Field label="Variety" hint="Optional, for example white or brown">
                  <Input value={form.variety} onChange={set('variety')} />
                </Field>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
                <Field label="Quantity" required>
                  <Input type="number" inputMode="decimal" min={0} step="any" value={form.quantity} onChange={set('quantity')} />
                </Field>
                <Field label="Unit">
                  <Select value={form.unit} onChange={set('unit')} options={['kg', 'tonne', 'bag', 'crate'].map((u) => ({ value: u, label: u }))} />
                </Field>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Harvest date" required>
                  <Input type="date" value={form.production_date} max={today()} onChange={set('production_date')} />
                </Field>
                <Field label="State of origin">
                  <Select value={form.origin_state} onChange={set('origin_state')} placeholder="Choose a state"
                    options={NIGERIAN_STATES.map((s) => ({ value: s, label: s }))} />
                </Field>
              </div>
              <Field label="Destination country" hint={corridor === 'DEFAULT' ? 'Two-letter code, optional' : undefined}>
                {corridor === 'NG-EU-SESAME'
                  ? <Select value={form.destination_country} onChange={set('destination_country')} options={EU_COUNTRIES.map(([c, n]) => ({ value: c, label: n }))} />
                  : corridor === 'NG-AE-SESAME'
                    ? <Input value="United Arab Emirates" readOnly aria-readonly />
                    : <Input value={form.destination_country} maxLength={2} onChange={set('destination_country')} className="uppercase" />}
              </Field>
              <Field label="Buyer's Nexus ID" required={buyerRequired}
                hint={buyerRequired
                  ? 'Required on this corridor: the buyer confirms delivery. For example NX-BU-1A2B3C'
                  : 'Optional. A named buyer can follow the batch and confirm delivery. For example NX-BU-1A2B3C'}>
                <Input value={form.buyer_nexus_id} onChange={set('buyer_nexus_id')} autoCapitalize="characters" spellCheck={false}
                  className="font-mono uppercase" />
              </Field>
              <Field label="Notes" hint="Optional">
                <Textarea rows={2} value={form.notes} onChange={set('notes')} />
              </Field>
              <Button type="submit" size="lg" loading={busy}><Sprout aria-hidden /> Create batch</Button>
            </form>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardContent className="text-sm">
            <h2 className="font-display font-bold text-ink">{CORRIDORS[corridor].label}: what you will need</h2>
            <p className="mt-1 text-ink-muted">Each stage opens only when its documents are on file.</p>
            <h3 className="mt-3 font-semibold text-ink">Before packing</h3>
            <ul className="mt-1 list-disc pl-5 text-ink-muted">{packed.map((r) => <li key={r.type}>{docLabel(r.type)}</li>)}</ul>
            <h3 className="mt-3 font-semibold text-ink">Before export</h3>
            <ul className="mt-1 list-disc pl-5 text-ink-muted">{exported.map((r) => <li key={r.type}>{docLabel(r.type)}</li>)}</ul>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

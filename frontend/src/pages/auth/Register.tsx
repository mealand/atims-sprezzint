import { useMemo, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronRight, Eye, EyeOff, LocateFixed, Check } from 'lucide-react';
import {
  NIGERIAN_STATES, PASSWORD_MIN_LENGTH, PROFILE_SCHEMAS, accountSchema, type SelfRegisterRole,
} from '@atims/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  Button, Card, CardContent, Field, Input, Select, Stepper, cn, roleMeta,
} from '../../components/ui';
import { AuthShell, FormAlert } from './AuthShell';

/** Re-exported for pages that still use the old card wrapper (Verify.tsx). */
export { AuthCard } from './AuthShell';
import { EmailCodeStep, type Verification } from './EmailCodeStep';

/* ── Reference data ─────────────────────────────────────────────────────── */

const ROLE_ORDER: SelfRegisterRole[] = ['farmer', 'aggregator', 'processor', 'exporter', 'lab', 'inspector', 'buyer', 'regulator'];

/** What each role should have to hand before starting. */
const ROLE_NEEDS: Record<SelfRegisterRole, string> = {
  farmer: 'Phone, farm location and size, crops',
  aggregator: 'CAC number and warehouse address',
  processor: 'CAC number and packhouse address',
  exporter: 'CAC, NEPC exporter number and TIN',
  lab: 'ISO 17025 accreditation number',
  inspector: 'Organisation and staff ID',
  buyer: 'Company and country',
  regulator: 'Agency and staff ID',
};

const NAME_LABEL: Record<SelfRegisterRole, { label: string; hint: string }> = {
  farmer: { label: 'Full name', hint: 'As it appears on your ID or cooperative records' },
  aggregator: { label: 'Business name', hint: 'The registered name on your CAC certificate' },
  processor: { label: 'Business name', hint: 'The registered name on your CAC certificate' },
  exporter: { label: 'Company name', hint: 'The registered name on your CAC certificate' },
  lab: { label: 'Laboratory name', hint: 'As shown on your accreditation certificate' },
  inspector: { label: 'Full name', hint: 'Your name as an inspecting officer' },
  buyer: { label: 'Your name or trading name', hint: 'Shown to exporters who ship to you' },
  regulator: { label: 'Full name', hint: 'Your name as an agency officer' },
};

const COMMON_CROPS = ['Sesame', 'Cashew', 'Cocoa', 'Ginger', 'Hibiscus', 'Shea', 'Soybean', 'Groundnut', 'Maize', 'Sorghum'];

const BUYER_COUNTRIES: Array<[string, string]> = [
  ['AE', 'United Arab Emirates'], ['NL', 'Netherlands'], ['DE', 'Germany'], ['BE', 'Belgium'], ['FR', 'France'],
  ['IT', 'Italy'], ['ES', 'Spain'], ['GB', 'United Kingdom'], ['TR', 'Türkiye'], ['SA', 'Saudi Arabia'],
  ['CN', 'China'], ['JP', 'Japan'], ['KR', 'South Korea'], ['IN', 'India'], ['IL', 'Israel'], ['US', 'United States'],
  ['NG', 'Nigeria'],
];

const STEPS = [{ label: 'Role' }, { label: 'Details' }, { label: 'Account' }, { label: 'Confirm email' }];

/* ── Form state ─────────────────────────────────────────────────────────── */

type Values = Record<string, string>;
type Errors = Record<string, string>;

const blankProfile: Values = {
  phone: '', state: '', lga: '', lat: '', lng: '', farm_size_ha: '', other_crops: '', cooperative: '',
  cac_number: '', wh_address: '', wh_state: '', wh_lat: '', wh_lng: '',
  nepc_number: '', tin: '', iso17025_accreditation_number: '', accreditation_body: '',
  organisation: '', staff_id: '', company: '', country: '', country_other: '', import_licence: '', agency: '',
};

const num = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : Number(s));

/** Turn the flat form into the `profile` object the shared schema expects. */
function buildProfile(role: SelfRegisterRole, v: Values, crops: string[]): Record<string, unknown> {
  switch (role) {
    case 'farmer': {
      const extra = v.other_crops.split(',').map((c) => c.trim()).filter(Boolean);
      return {
        phone: v.phone, state: v.state, lga: v.lga,
        farm_gps: { lat: num(v.lat), lng: num(v.lng) },
        farm_size_ha: num(v.farm_size_ha),
        crops: [...crops, ...extra],
        cooperative: v.cooperative,
      };
    }
    case 'aggregator':
    case 'processor': {
      const lat = num(v.wh_lat); const lng = num(v.wh_lng);
      return {
        cac_number: v.cac_number,
        warehouse_location: {
          address: v.wh_address, state: v.wh_state,
          ...(lat !== undefined || lng !== undefined ? { gps: { lat, lng } } : {}),
        },
      };
    }
    case 'exporter': return { cac_number: v.cac_number, nepc_number: v.nepc_number, tin: v.tin };
    case 'lab': return { iso17025_accreditation_number: v.iso17025_accreditation_number, accreditation_body: v.accreditation_body };
    case 'inspector': return { organisation: v.organisation, staff_id: v.staff_id };
    case 'buyer': return {
      company: v.company,
      country: v.country === 'other' ? v.country_other : v.country,
      import_licence: v.import_licence,
    };
    case 'regulator': return { agency: v.agency, staff_id: v.staff_id };
  }
}

/** Map a schema path (relative to `profile`) to the form field that shows its error. */
function fieldForPath(path: string): string {
  if (path.startsWith('farm_gps')) return 'farm_gps';
  if (path.startsWith('warehouse_location.gps')) return 'wh_gps';
  if (path === 'warehouse_location.address') return 'wh_address';
  if (path === 'warehouse_location.state') return 'wh_state';
  if (path === 'country') return 'country';
  return path.split('.')[0];
}

function sentence(msg: string) { return msg.charAt(0).toUpperCase() + msg.slice(1); }

/* ── Wizard ─────────────────────────────────────────────────────────────── */

export default function Register() {
  const { me, loading } = useAuth();
  const [params] = useSearchParams();
  const preset = params.get('role') as SelfRegisterRole | null;
  const validPreset = preset && ROLE_ORDER.includes(preset) ? preset : null;

  const [step, setStep] = useState(validPreset ? 1 : 0);
  const [role, setRole] = useState<SelfRegisterRole | null>(validPreset);
  const [values, setValues] = useState<Values>(blankProfile);
  const [crops, setCrops] = useState<string[]>([]);
  const [account, setAccount] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<ReactNode>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registered, setRegistered] = useState<{ email: string; nexus_id: string; verification: Verification } | null>(null);

  if (!loading && me) return <Navigate to="/" replace />;

  const set = (k: string) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    if (errors[k]) setErrors(({ [k]: _drop, ...rest }) => rest);
  };
  const setAcc = (k: keyof typeof account) => (e: { target: { value: string } }) => {
    setAccount((a) => ({ ...a, [k]: e.target.value }));
    if (errors[k]) setErrors(({ [k]: _drop, ...rest }) => rest);
  };

  function chooseRole(r: SelfRegisterRole) {
    if (r !== role) { setValues(blankProfile); setCrops([]); setErrors({}); }
    setRole(r); setFormError(null); setStep(1);
    window.scrollTo({ top: 0 });
  }

  function validateProfile(): boolean {
    if (!role) return false;
    const r = PROFILE_SCHEMAS[role].safeParse(buildProfile(role, values, crops));
    if (r.success) { setErrors({}); return true; }
    const next: Errors = {};
    for (const i of r.error.issues) {
      const k = fieldForPath(i.path.join('.'));
      if (!next[k]) next[k] = sentence(i.message);
    }
    setErrors(next);
    focusFirstError();
    return false;
  }

  function validateAccount(): boolean {
    const r = accountSchema.safeParse(account);
    const next: Errors = {};
    if (!r.success) for (const i of r.error.issues) { const k = String(i.path[0]); if (!next[k]) next[k] = sentence(i.message); }
    if (account.password && account.confirm !== account.password) next.confirm = 'Passwords do not match';
    setErrors(next);
    if (Object.keys(next).length) { focusFirstError(); return false; }
    return true;
  }

  async function submit() {
    if (!role || !validateAccount()) return;
    setSubmitting(true); setFormError(null);
    try {
      const d = await api<{ entity: { nexus_id: string; email: string }; verification: Verification }>('/auth/register', {
        method: 'POST',
        body: { role, name: account.name, email: account.email, password: account.password, profile: buildProfile(role, values, crops) },
      });
      const email = d.entity.email ?? account.email.trim().toLowerCase();
      try { sessionStorage.setItem('atims_pending_email', JSON.stringify({ email, nexus_id: d.entity.nexus_id })); } catch { /* private mode */ }
      setRegistered({ email, nexus_id: d.entity.nexus_id, verification: d.verification });
      setStep(3);
      window.scrollTo({ top: 0 });
    } catch (err) {
      handleServerError(err as { message: string; data?: { code?: string; issues?: Array<{ path: string; message: string }> } });
    } finally {
      setSubmitting(false);
    }
  }

  function handleServerError({ message, data }: { message: string; data?: { code?: string; issues?: Array<{ path: string; message: string }> } }) {
    const issues = data?.issues ?? [];
    const profileErrs: Errors = {}; const accountErrs: Errors = {};
    for (const i of issues) {
      if (i.path.startsWith('profile')) profileErrs[fieldForPath(i.path.replace(/^profile\.?/, ''))] = sentence(i.message);
      else if (i.path) accountErrs[i.path.split('.')[0]] = sentence(i.message);
    }
    if (data?.code === 'EMAIL_TAKEN') {
      setErrors({ email: 'An account with this email already exists' });
      setFormError(<>This email is already registered. <Link className="font-semibold underline" to="/login">Sign in</Link>, or{' '}
        <Link className="font-semibold underline" to={`/verify-email?email=${encodeURIComponent(account.email.trim())}`}>enter your code</Link> if you never confirmed it.</>);
      return;
    }
    if (Object.keys(profileErrs).length) {
      setErrors(profileErrs); setStep(1);
      setFormError(data?.code === 'IDENTIFIER_TAKEN'
        ? 'A registration number on this form is already used by another account. Check it, or sign in if this is your business.'
        : 'Please fix the highlighted details.');
      return;
    }
    if (Object.keys(accountErrs).length) setErrors(accountErrs);
    setFormError(message === 'Failed to fetch' ? 'Could not reach the server. Check your connection and try again.' : sentence(message || 'Registration failed'));
  }

  const meta = role ? roleMeta(role) : null;

  return (
    <AuthShell wide={step === 0}>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Create your ATiMs account</h1>
        <p className="mt-1 text-sm text-ink-muted">
          No waiting for approval: confirm your email and you can start right away.
        </p>
      </div>
      <Stepper steps={STEPS} current={step} className="mb-6" />

      {step === 0 && (
        <section aria-labelledby="role-h">
          <h2 id="role-h" className="mb-3 font-display text-lg font-bold text-ink">Which best describes you?</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {ROLE_ORDER.map((r) => {
              const m = roleMeta(r);
              const Icon = m.icon;
              const selected = role === r;
              return (
                <li key={r}>
                  <button type="button" onClick={() => chooseRole(r)} aria-label={`Register as ${m.label}. ${m.blurb}`}
                    className={cn(
                      'group flex h-full w-full items-start gap-3 rounded-xl border bg-surface p-4 text-left shadow-card transition-colors',
                      'hover:border-primary/40 hover:bg-primary-soft/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                      selected ? 'border-primary ring-1 ring-primary' : 'border-line',
                    )}>
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: m.color }} aria-hidden>
                      <Icon className="size-5.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        {m.label}
                        {selected && <Check className="size-4 text-primary" aria-hidden />}
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-muted">{m.blurb}</span>
                      <span className="mt-2 block text-xs text-ink-subtle">You will need: {ROLE_NEEDS[r]}</span>
                    </span>
                    <ChevronRight className="mt-3 size-5 shrink-0 text-ink-subtle group-hover:text-primary" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-6 text-center text-sm text-ink-muted">
            Already have an account? <Link to="/login" className="font-semibold text-primary underline-offset-4 hover:underline">Sign in</Link>
            <span className="mx-2" aria-hidden>·</span>
            <Link to="/verify-email" className="font-semibold text-primary underline-offset-4 hover:underline">I have a code</Link>
          </p>
        </section>
      )}

      {step === 1 && role && meta && (
        <Card>
          <CardContent>
            <form noValidate onSubmit={(e) => { e.preventDefault(); if (validateProfile()) { setFormError(null); setStep(2); window.scrollTo({ top: 0 }); } }}
              className="flex flex-col gap-5">
              <RoleHeading role={role} onChange={() => setStep(0)} />
              {formError && <FormAlert>{formError}</FormAlert>}
              <ProfileFields role={role} values={values} set={set} setValues={setValues} errors={errors} setErrors={setErrors}
                crops={crops} setCrops={setCrops} />
              <StepNav onBack={() => setStep(0)} nextLabel="Continue" />
            </form>
          </CardContent>
        </Card>
      )}

      {step === 2 && role && (
        <Card>
          <CardContent>
            <form noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex flex-col gap-5">
              <RoleHeading role={role} onChange={() => setStep(0)} />
              {formError && <FormAlert>{formError}</FormAlert>}
              <Field label={NAME_LABEL[role].label} hint={NAME_LABEL[role].hint} error={errors.name} required>
                <Input name="name" value={account.name} onChange={setAcc('name')} autoComplete={['farmer', 'inspector', 'regulator'].includes(role) ? 'name' : 'organization'} />
              </Field>
              <Field label="Email" hint="We send a 6-digit code here to confirm it is yours" error={errors.email} required>
                <Input name="email" type="email" value={account.email} onChange={setAcc('email')} autoComplete="email" inputMode="email" spellCheck={false} />
              </Field>
              <PasswordFields account={account} setAcc={setAcc} errors={errors} />
              <p className="text-xs text-ink-muted">
                Your details are checked automatically for format and uniqueness. An administrator may later verify your
                business documents (KYB) to give you a higher trust badge, but you do not need to wait for that.
              </p>
              <StepNav onBack={() => { setFormError(null); setStep(1); }} nextLabel={submitting ? 'Creating account' : 'Create account'} loading={submitting} />
            </form>
          </CardContent>
        </Card>
      )}

      {step === 3 && registered && (
        <Card>
          <CardContent className="flex flex-col gap-5">
            <div className="rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
              <p className="text-ink-muted">Your Nexus ID (you sign in with this):</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-ink" data-testid="nexus-id">{registered.nexus_id}</p>
            </div>
            <EmailCodeStep email={registered.email} nexusId={registered.nexus_id} verification={registered.verification} />
          </CardContent>
        </Card>
      )}
    </AuthShell>
  );
}

function focusFirstError() {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
    el?.focus();
  });
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function RoleHeading({ role, onChange }: { role: SelfRegisterRole; onChange: () => void }) {
  const m = roleMeta(role);
  const Icon = m.icon;
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: m.color }} aria-hidden>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-lg font-bold text-ink">Registering as {m.label.toLowerCase()}</h2>
      </div>
      <Button variant="link" size="sm" onClick={onChange}>Change</Button>
    </div>
  );
}

function StepNav({ onBack, nextLabel, loading }: { onBack: () => void; nextLabel: string; loading?: boolean }) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
      <Button variant="outline" onClick={onBack} size="lg"><ArrowLeft aria-hidden /> Back</Button>
      <Button type="submit" size="lg" loading={loading}>{nextLabel} {!loading && <ArrowRight aria-hidden />}</Button>
    </div>
  );
}

function TextField({ label, hint, error, required, ...props }:
  { label: string; hint?: ReactNode; error?: string; required?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      <Input {...props} />
    </Field>
  );
}

const stateOptions = NIGERIAN_STATES.map((s) => ({ value: s, label: s === 'FCT' ? 'FCT (Abuja)' : s }));

interface ProfileProps {
  role: SelfRegisterRole;
  values: Values;
  set: (k: string) => (e: { target: { value: string } }) => void;
  setValues: React.Dispatch<React.SetStateAction<Values>>;
  errors: Errors;
  setErrors: React.Dispatch<React.SetStateAction<Errors>>;
  crops: string[];
  setCrops: React.Dispatch<React.SetStateAction<string[]>>;
}

function ProfileFields(p: ProfileProps) {
  const { role, values: v, set, errors: e } = p;
  switch (role) {
    case 'farmer':
      return (
        <>
          <TextField label="Phone number" hint="For example 08031234567" error={e.phone} required
            name="phone" type="tel" inputMode="tel" autoComplete="tel" value={v.phone} onChange={set('phone')} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="State" error={e.state} required>
              <Select value={v.state} onChange={set('state')} placeholder="Choose a state" options={stateOptions} />
            </Field>
            <TextField label="LGA" hint="Local government area" error={e.lga} required name="lga" value={v.lga} onChange={set('lga')} />
          </div>
          <GpsFields label="Farm location" required latKey="lat" lngKey="lng" errorKey="farm_gps" {...p}
            hint="Stand on your farm and tap the button, or type the coordinates." />
          <TextField label="Farm size (hectares)" error={e.farm_size_ha} required name="farm_size_ha"
            type="number" inputMode="decimal" min={0} step="any" value={v.farm_size_ha} onChange={set('farm_size_ha')} />
          <CropPicker {...p} />
          <TextField label="Cooperative" hint="Optional" error={e.cooperative} name="cooperative" value={v.cooperative} onChange={set('cooperative')} />
        </>
      );
    case 'aggregator':
    case 'processor':
      return (
        <>
          <TextField label="CAC registration number" hint="For example RC1234567 or BN1234567" error={e.cac_number} required
            name="cac_number" autoCapitalize="characters" spellCheck={false} value={v.cac_number} onChange={set('cac_number')} />
          <TextField label={role === 'processor' ? 'Packhouse address' : 'Warehouse address'} error={e.wh_address} required
            name="wh_address" autoComplete="street-address" value={v.wh_address} onChange={set('wh_address')} />
          <Field label="State" error={e.wh_state} required>
            <Select value={v.wh_state} onChange={set('wh_state')} placeholder="Choose a state" options={stateOptions} />
          </Field>
          <GpsFields label="Location (optional)" latKey="wh_lat" lngKey="wh_lng" errorKey="wh_gps" {...p} />
        </>
      );
    case 'exporter':
      return (
        <>
          <TextField label="CAC registration number" hint="For example RC1234567" error={e.cac_number} required
            name="cac_number" autoCapitalize="characters" spellCheck={false} value={v.cac_number} onChange={set('cac_number')} />
          <TextField label="NEPC exporter number" hint="From your NEPC exporter certificate" error={e.nepc_number} required
            name="nepc_number" autoCapitalize="characters" spellCheck={false} value={v.nepc_number} onChange={set('nepc_number')} />
          <TextField label="TIN" hint="For example 12345678-0001" error={e.tin} required
            name="tin" inputMode="numeric" spellCheck={false} value={v.tin} onChange={set('tin')} />
        </>
      );
    case 'lab':
      return (
        <>
          <TextField label="ISO 17025 accreditation number" error={e.iso17025_accreditation_number} required
            name="iso17025_accreditation_number" autoCapitalize="characters" spellCheck={false}
            value={v.iso17025_accreditation_number} onChange={set('iso17025_accreditation_number')} />
          <TextField label="Accreditation body" hint="Optional, for example NiNAS or UKAS" error={e.accreditation_body}
            name="accreditation_body" list="acc-bodies" value={v.accreditation_body} onChange={set('accreditation_body')} />
          <datalist id="acc-bodies">{['NiNAS', 'UKAS', 'SANAS', 'DAkkS', 'A2LA'].map((x) => <option key={x} value={x} />)}</datalist>
        </>
      );
    case 'inspector':
      return (
        <>
          <TextField label="Organisation" hint="For example NAQS" error={e.organisation} required
            name="organisation" list="insp-orgs" value={v.organisation} onChange={set('organisation')} />
          <datalist id="insp-orgs">
            {['Nigeria Agricultural Quarantine Service (NAQS)', 'SGS', 'Bureau Veritas', 'Intertek', 'Cotecna'].map((x) => <option key={x} value={x} />)}
          </datalist>
          <TextField label="Staff ID" error={e.staff_id} required name="staff_id" autoCapitalize="characters" spellCheck={false}
            value={v.staff_id} onChange={set('staff_id')} />
        </>
      );
    case 'buyer':
      return (
        <>
          <TextField label="Company" error={e.company} required name="company" autoComplete="organization" value={v.company} onChange={set('company')} />
          <Field label="Country" error={e.country} required>
            <Select value={v.country} onChange={set('country')} placeholder="Choose a country"
              options={[...BUYER_COUNTRIES.map(([c, n]) => ({ value: c, label: n })), { value: 'other', label: 'Other country' }]} />
          </Field>
          {v.country === 'other' && (
            <TextField label="Country code" hint="Two letters, for example QA for Qatar" error={e.country} required
              name="country_other" maxLength={2} autoCapitalize="characters" value={v.country_other} onChange={set('country_other')} />
          )}
          <TextField label="Import licence" hint="Optional" error={e.import_licence} name="import_licence"
            autoCapitalize="characters" spellCheck={false} value={v.import_licence} onChange={set('import_licence')} />
        </>
      );
    case 'regulator':
      return (
        <>
          <TextField label="Agency" hint="For example NAFDAC, NEPC or NAQS" error={e.agency} required
            name="agency" list="agencies" value={v.agency} onChange={set('agency')} />
          <datalist id="agencies">{['NAFDAC', 'NEPC', 'NAQS', 'SON', 'FMAFS'].map((x) => <option key={x} value={x} />)}</datalist>
          <TextField label="Staff ID" error={e.staff_id} required name="staff_id" autoCapitalize="characters" spellCheck={false}
            value={v.staff_id} onChange={set('staff_id')} />
        </>
      );
  }
}

function CropPicker({ crops, setCrops, values, set, errors, setErrors }: ProfileProps) {
  const toggle = (c: string) => {
    setCrops((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));
    if (errors.crops) setErrors(({ crops: _drop, ...rest }) => rest);
  };
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={errors.crops ? 'crops-error' : undefined}>
      <legend className="mb-1.5 text-sm font-medium text-ink">Crops you grow<span className="ml-0.5 text-primary" aria-hidden>*</span></legend>
      <div className="flex flex-wrap gap-2">
        {COMMON_CROPS.map((c) => {
          const on = crops.includes(c);
          return (
            <button key={c} type="button" onClick={() => toggle(c)} aria-pressed={on}
              className={cn('inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
                on ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong bg-surface text-ink hover:bg-surface-muted')}>
              {on && <Check className="size-4" aria-hidden />}{c}
            </button>
          );
        })}
      </div>
      <Field label="Other crops" hint="Optional, separated by commas" className="mt-2">
        <Input name="other_crops" value={values.other_crops} onChange={(e) => { set('other_crops')(e); if (errors.crops) setErrors(({ crops: _d, ...r }) => r); }} />
      </Field>
      {errors.crops && <p id="crops-error" className="text-xs font-medium text-primary-dark">{errors.crops}</p>}
    </fieldset>
  );
}

function GpsFields({ label, hint, required, latKey, lngKey, errorKey, values, setValues, errors, setErrors }:
  ProfileProps & { label: string; hint?: string; required?: boolean; latKey: string; lngKey: string; errorKey: string }) {
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const supported = useMemo(() => typeof navigator !== 'undefined' && 'geolocation' in navigator, []);
  const err = errors[errorKey];

  function locate() {
    if (!supported) { setStatus('This browser cannot share its location. Type the coordinates instead.'); return; }
    setLocating(true); setStatus(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setValues((v) => ({ ...v, [latKey]: pos.coords.latitude.toFixed(6), [lngKey]: pos.coords.longitude.toFixed(6) }));
        setErrors(({ [errorKey]: _drop, ...rest }) => rest);
        setStatus(`Location captured (accuracy about ${Math.round(pos.coords.accuracy)} m).`);
        setLocating(false);
      },
      (e) => {
        setStatus(e.code === e.PERMISSION_DENIED
          ? 'Location permission was refused. Allow it in your browser settings, or type the coordinates.'
          : 'Could not get your location. Try again outdoors, or type the coordinates.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    );
  }

  const onChange = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    if (err) setErrors(({ [errorKey]: _drop, ...rest }) => rest);
  };

  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={err ? `${errorKey}-error` : undefined}>
      <legend className="mb-1.5 text-sm font-medium text-ink">{label}{required && <span className="ml-0.5 text-primary" aria-hidden>*</span>}</legend>
      <Button variant="outline" onClick={locate} loading={locating} className="self-start">
        {!locating && <LocateFixed aria-hidden />} {locating ? 'Finding you' : 'Use my location'}
      </Button>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
      {status && <p role="status" className="text-xs text-ink-muted">{status}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude">
          <Input name={latKey} inputMode="decimal" value={values[latKey]} onChange={onChange(latKey)} placeholder="9.0765"
            aria-invalid={err ? true : undefined} />
        </Field>
        <Field label="Longitude">
          <Input name={lngKey} inputMode="decimal" value={values[lngKey]} onChange={onChange(lngKey)} placeholder="7.3986"
            aria-invalid={err ? true : undefined} />
        </Field>
      </div>
      {err && <p id={`${errorKey}-error`} className="text-xs font-medium text-primary-dark">{err}</p>}
    </fieldset>
  );
}

function PasswordFields({ account, setAcc, errors }:
  { account: { password: string; confirm: string }; setAcc: (k: 'password' | 'confirm') => (e: { target: { value: string } }) => void; errors: Errors }) {
  const [show, setShow] = useState(false);
  const toggle = (
    <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
      className="mr-1 inline-flex size-10 min-h-0 items-center justify-center rounded-md bg-transparent p-0 text-ink-muted hover:bg-surface-muted hover:text-ink">
      {show ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
    </button>
  );
  return (
    <>
      <Field label="Password" hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase is easy to remember.`} error={errors.password} required>
        <Input name="new-password" type={show ? 'text' : 'password'} autoComplete="new-password" value={account.password}
          onChange={setAcc('password')} trailing={toggle} />
      </Field>
      <Field label="Repeat password" error={errors.confirm} required>
        <Input name="confirm-password" type={show ? 'text' : 'password'} autoComplete="new-password" value={account.confirm} onChange={setAcc('confirm')} />
      </Field>
    </>
  );
}

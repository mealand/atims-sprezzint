import { useEffect, useState } from 'react';
import { BadgeCheck, CircleDashed, Copy, Eye, EyeOff, KeyRound, MailCheck, ShieldCheck, Upload, UserRound } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { ensureKey, backupPhrase, importPhrase } from '../lib/keys';
import { api } from '../lib/api';
import {
  Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, Field, Input, LoadingRows, RoleBadge, TRUST_META, TrustBadge, cn, trustTierOf, type TrustTier,
} from '../components/ui';
import { PASSWORD_MIN_LENGTH } from '@atims/shared';
import { useMe, type MeProfile } from './dashboards/shared';

/** Settings: profile, trust tier, device signing key backup, password. */
export default function Settings() {
  return (
    <DashboardLayout bare title="Settings" description="Your account, trust level and signing key.">
      <SettingsBody />
    </DashboardLayout>
  );
}

function SettingsBody() {
  const { data: me, isLoading } = useMe();
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {isLoading || !me ? <Card><CardContent><LoadingRows rows={3} label="Loading profile" /></CardContent></Card> : <ProfileCard me={me} />}
      {me ? <TrustCard me={me} /> : <div />}
      <DeviceKeyCard />
      <PasswordCard />
    </div>
  );
}

/* ── Profile ────────────────────────────────────────────────────────────── */

const LABELS: Record<string, string> = {
  phone: 'Phone', state: 'State', lga: 'LGA', farm_gps: 'Farm GPS', farm_size_ha: 'Farm size (ha)', crops: 'Crops', cooperative: 'Cooperative',
  cac_number: 'CAC number', warehouse_location: 'Warehouse', nepc_number: 'NEPC exporter number', tin: 'TIN',
  iso17025_accreditation_number: 'ISO 17025 number', accreditation_body: 'Accreditation body', organisation: 'Organisation',
  staff_id: 'Staff ID', company: 'Company', country: 'Country', import_licence: 'Import licence', agency: 'Agency',
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'Not given';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('lat' in o && 'lng' in o) return `${o.lat}, ${o.lng}`;
    return [o.address, o.state, o.gps ? show(o.gps) : null].filter(Boolean).map(String).join(', ');
  }
  return String(v);
}

function ProfileCard({ me }: { me: MeProfile }) {
  const [copied, setCopied] = useState(false);
  const profile = Object.entries(me.profile ?? {});
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><UserRound className="size-5 text-ink-muted" aria-hidden /> Profile</CardTitle>
        <CardDescription>Registration details. Contact Sprezz support to correct them.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
          <Row k="Name" v={me.name} />
          <div className="min-w-0">
            <dt className="text-xs text-ink-muted">Role</dt>
            <dd className="mt-0.5"><RoleBadge role={me.role} size="sm" /></dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-ink-muted">Nexus ID (sign-in)</dt>
            <dd className="flex items-center gap-1 font-mono font-semibold text-ink">
              {me.nexus_id}
              <Button variant="ghost" size="sm" className="h-8 px-2" aria-label="Copy Nexus ID"
                onClick={() => { void navigator.clipboard?.writeText(me.nexus_id); setCopied(true); }}>
                <Copy aria-hidden />{copied && <span className="text-xs">Copied</span>}
              </Button>
            </dd>
          </div>
          <Row k="Email" v={me.email ?? 'Not set'} />
          {profile.map(([k, v]) => <Row key={k} k={LABELS[k] ?? k} v={show(v)} />)}
          {me.created_at && <Row k="Member since" v={new Date(me.created_at).toLocaleDateString()} />}
        </dl>
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{k}</dt>
      <dd className="break-words text-ink">{v}</dd>
    </div>
  );
}

/* ── Trust tier ─────────────────────────────────────────────────────────── */

const TIER_STEPS: Array<{ tier: TrustTier; icon: typeof BadgeCheck; how: string }> = [
  { tier: 'registered', icon: CircleDashed, how: 'Registration form accepted.' },
  { tier: 'self_verified', icon: MailCheck, how: 'Email code confirmed and automatic checks passed. You can work immediately.' },
  { tier: 'kyb_verified', icon: BadgeCheck, how: 'Documents checked by a Sprezz administrator (or, for farmers, a KYB-verified inspector).' },
];

function TrustCard({ me }: { me: MeProfile }) {
  const tier = trustTierOf(me);
  const reached = TIER_STEPS.findIndex((s) => s.tier === tier);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-ink-muted" aria-hidden /> Trust level</CardTitle>
        <CardDescription>Shown to buyers and inspectors next to everything you sign.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <TrustBadge tier={tier} />
          <span className="text-sm text-ink-muted">{TRUST_META[tier].description}</span>
        </div>
        <ol className="mt-4 flex flex-col gap-3">
          {TIER_STEPS.map((s, i) => (
            <li key={s.tier} className="flex items-start gap-3">
              <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full',
                i <= reached ? 'bg-brand-green-soft text-brand-green-ink' : 'bg-surface-muted text-ink-subtle')} aria-hidden>
                <s.icon className="size-4" />
              </span>
              <div className="min-w-0 text-sm">
                <p className={cn('font-semibold', i <= reached ? 'text-ink' : 'text-ink-muted')}>
                  {TRUST_META[s.tier].label}<span className="sr-only">{i <= reached ? ' (reached)' : ' (not yet)'}</span>
                </p>
                <p className="text-ink-muted">{s.how}</p>
              </div>
            </li>
          ))}
        </ol>
        {tier === 'kyb_verified' && me.verified_by_nexus_id && (
          <p className="mt-3 text-xs text-ink-muted">
            Verified by <span className="font-mono">{me.verified_by_nexus_id}</span>
            {me.kyb_verified_at ? ` on ${new Date(me.kyb_verified_at).toLocaleDateString()}` : ''}.
          </p>
        )}
        {tier === 'self_verified' && (
          <p className="mt-3 text-xs text-ink-muted">KYB review is optional and does not block your work.</p>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Device key ─────────────────────────────────────────────────────────── */

function DeviceKeyCard() {
  const [pubkey, setPubkey] = useState('');
  const [phrase, setPhrase] = useState('');
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState('');
  const [restoreMsg, setRestoreMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    ensureKey().then((k) => { setPubkey(k.pubkeyB64); setPhrase(backupPhrase()); }).catch(() => setPubkey(''));
  }, []);

  async function restore(e: React.FormEvent) {
    e.preventDefault();
    const ok = await importPhrase(input.trim());
    setRestoreMsg(ok ? { ok: true, text: 'Key restored. New events are signed with it.' } : { ok: false, text: 'That is not a valid 64-character backup phrase.' });
    if (ok) { const k = await ensureKey(); setPubkey(k.pubkeyB64); setPhrase(backupPhrase()); setInput(''); setRevealed(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="size-5 text-ink-muted" aria-hidden /> Device signing key</CardTitle>
        <CardDescription>
          Created in this browser. The private key never leaves this device; the server only checks signatures with the public key.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-xs text-ink-muted">Public key</p>
          <p className="break-all font-mono text-xs text-ink">{pubkey || 'Generating'}</p>
        </div>

        <div className="rounded-lg border border-brand-yellow/50 bg-brand-yellow-soft p-3 text-sm text-brand-yellow-ink">
          Back up your key. If this browser's data is cleared without a backup, you cannot sign from a new device as the same key.
        </div>

        {revealed ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-ink-muted">Backup phrase: write it down and keep it private</p>
            <p className="break-all rounded-lg bg-surface-muted p-3 font-mono text-sm text-ink" data-testid="seed">{phrase}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(phrase); setCopied(true); }}>
                <Copy aria-hidden /> {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRevealed(false)}><EyeOff aria-hidden /> Hide</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="self-start" onClick={() => setRevealOpen(true)} disabled={!phrase}>
            <Eye aria-hidden /> Show backup phrase
          </Button>
        )}

        <form onSubmit={restore} className="flex flex-col gap-2 border-t border-line pt-4">
          <Field label="Restore from a backup phrase" hint="Replaces the key on this device">
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="64 hexadecimal characters"
              autoComplete="off" spellCheck={false} className="font-mono text-sm" />
          </Field>
          <Button type="submit" variant="secondary" className="self-start" disabled={!input.trim()}><Upload aria-hidden /> Restore key</Button>
          {restoreMsg && <p role="status" className={cn('text-sm', restoreMsg.ok ? 'text-brand-green-ink' : 'text-primary-dark')}>{restoreMsg.text}</p>}
        </form>
      </CardContent>

      <Dialog open={revealOpen} onOpenChange={setRevealOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Show your backup phrase?</DialogTitle>
            <DialogDescription>Anyone who sees it can sign as you. Make sure nobody is looking at your screen.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRevealOpen(false)}>Cancel</Button>
            <Button onClick={() => { setRevealed(true); setRevealOpen(false); }}>Show it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ── Password ───────────────────────────────────────────────────────────── */

function PasswordCard() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < PASSWORD_MIN_LENGTH) { setMsg({ ok: false, text: `New password must be at least ${PASSWORD_MIN_LENGTH} characters.` }); return; }
    if (next !== again) { setMsg({ ok: false, text: 'New passwords do not match.' }); return; }
    setBusy(true);
    try {
      await api('/auth/password', { method: 'POST', body: { current_password: cur, new_password: next } });
      setMsg({ ok: true, text: 'Password updated.' });
      setCur(''); setNext(''); setAgain('');
    } catch (err) {
      const m = (err as Error).message;
      setMsg({ ok: false, text: m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Could not update the password.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>You stay signed in on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {/* Lets password managers attach the new password to the right account. */}
          <input type="text" name="username" autoComplete="username" hidden readOnly />
          <Field label="Current password" required>
            <Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
          </Field>
          <Field label="New password" hint={`At least ${PASSWORD_MIN_LENGTH} characters`} required>
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Repeat new password" required>
            <Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
          {msg && <p role={msg.ok ? 'status' : 'alert'} className={cn('text-sm font-medium', msg.ok ? 'text-brand-green-ink' : 'text-primary-dark')}>{msg.text}</p>}
          <Button type="submit" className="self-start" loading={busy} disabled={!cur || !next || !again}>Update password</Button>
        </form>
      </CardContent>
    </Card>
  );
}

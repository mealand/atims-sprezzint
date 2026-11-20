/** ATiMs landing page. Anonymous visitors can look up a batch trace, read how
 * the platform works and register. Logged-in users are routed by role (main.tsx).
 * Copy rule: no em or en dashes in marketing text. */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, Ban, Bitcoin, Check, ClipboardList, FileX as FileWarning, FingerprintPattern as Fingerprint, Link2, Lock,
  MapPin, QrCode, ScanLine, Search, ShieldCheck, Timer, UserPlus,
} from 'lucide-react';
import {
  Badge, BrandLockup, Button, Card, Input, ROLE_META, SELF_REGISTER_ROLES, cn,
} from '../components/ui';

/** Optional live demo traces, configured at build time:
 *  VITE_DEMO_TRACES="CROP-2026-000001|Sesame to Rotterdam,CROP-2026-000002|Sesame to Dubai" */
const DEMO_TRACES = String(import.meta.env.VITE_DEMO_TRACES ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [id, label] = s.split('|');
    return { id: id.trim(), label: (label ?? '').trim() };
  });

const PROBLEMS = [
  { icon: FileWarning, title: 'Paper trails break', body: 'Lab reports, packhouse logs and certificates live in emails and folders. By the time a buyer asks, nobody can show which document belongs to which bag.' },
  { icon: Ban, title: 'Problems surface at the port', body: 'Missing residue tests or phytosanitary checks are found after shipping, when a rejection costs the whole container.' },
  { icon: Fingerprint, title: 'Records can be edited', body: 'A spreadsheet can be changed after the fact. Buyers and regulators have no way to tell what was recorded when, and by whom.' },
];

const STEPS = [
  { icon: UserPlus, title: 'Register your role', body: 'Farmers, aggregators, processors, exporters, labs, inspectors and buyers each get an account and a signing key kept on their own device.' },
  { icon: ScanLine, title: 'Record each handover', body: 'Every harvest, handover and stage change is signed in your browser and added to an append-only, hash-chained ledger.' },
  { icon: Lock, title: 'Gates block missing evidence', body: 'A batch cannot advance to the next stage until the required documents, from the right roles, are on file.' },
  { icon: QrCode, title: 'Buyers verify by QR', body: 'Batch histories are timestamped on Bitcoin through OpenTimestamps. Anyone can scan the QR and re-check the chain in their own browser.' },
];

const CORRIDORS = [
  {
    code: 'NG-EU-SESAME', from: 'Nigeria', to: 'European Union', flag: 'EU',
    summary: 'Built around EU limits on pesticide residues and contaminants.',
    gates: [
      { stage: 'Packed', items: ['Batch photo', 'Packhouse log', 'Lab report: MRL, aflatoxin, ethylene oxide'] },
      { stage: 'Exported', items: ['Phytosanitary certificate from an inspector', 'Export declaration', 'Certificate of origin'] },
    ],
  },
  {
    code: 'NG-AE-SESAME', from: 'Nigeria', to: 'United Arab Emirates', flag: 'AE',
    summary: 'A lighter document set, with delivery confirmed by the buyer.',
    gates: [
      { stage: 'Packed', items: ['Batch photo', 'Packhouse log'] },
      { stage: 'Exported', items: ['Phytosanitary certificate from an inspector', 'Export declaration', 'Certificate of origin'] },
      { stage: 'Delivered', items: ['Delivery confirmed by the buyer'] },
    ],
  },
];

export default function Home() {
  const [traceId, setTraceId] = useState('');
  const navigate = useNavigate();

  function goTrace(e: React.FormEvent) {
    e.preventDefault();
    const id = traceId.trim().toUpperCase();
    if (id) navigate(`/trace/${encodeURIComponent(id)}`);
  }

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <a href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-primary focus:shadow-raised">
        Skip to content
      </a>

      {/* ── Top bar ── */}
      <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" aria-label="ATiMs home" className="rounded-lg"><BrandLockup /></Link>
          <nav aria-label="Sections" className="ml-6 hidden items-center gap-6 text-sm font-medium text-ink-muted md:flex">
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#corridors" className="hover:text-ink">Corridors</a>
            <a href="#roles" className="hover:text-ink">Roles</a>
            <Link to="/verify" className="hover:text-ink">Verify</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="ghost" size="sm"><Link to="/login">Log in</Link></Button>
            <Button asChild size="sm"><Link to="/register">Get started</Link></Button>
          </div>
        </div>
      </header>

      <main id="main" data-ui>
        {/* ── Hero ── */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 size-[34rem] rotate-45 rounded-[4rem] bg-primary/[0.06]" />
          <div aria-hidden className="pointer-events-none absolute -left-24 top-72 size-64 rotate-45 rounded-[2.5rem] bg-brand-yellow/10" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:pb-24 lg:pt-20">
            <div>
              <Badge variant="primary" className="mb-5">
                <MapPin aria-hidden /> Built in Abuja for Nigerian agricultural exports
              </Badge>
              <h1 className="font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-6xl">
                Prove where your produce came from, <span className="text-primary">at every step.</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-muted">
                ATiMs records every handover on a signed, tamper-evident ledger and stops a batch from moving on
                until the right evidence is on file. Buyers check the history themselves by scanning a QR code.
              </p>

              <form onSubmit={goTrace} className="mt-8 max-w-xl" role="search" aria-label="Trace a batch">
                <label htmlFor="trace-id" className="mb-2 block text-sm font-semibold text-ink">
                  Have a trace ID? Look up a batch
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input id="trace-id" name="traceId" leading={<Search />} placeholder="CROP-2026-000001"
                    autoComplete="off" autoCapitalize="characters" spellCheck={false}
                    className="h-12 font-mono uppercase placeholder:normal-case placeholder:font-sans"
                    value={traceId} onChange={(e) => setTraceId(e.target.value)} />
                  <Button type="submit" size="lg" className="shrink-0">
                    Trace batch <ArrowRight aria-hidden />
                  </Button>
                </div>
              </form>

              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                <Link to="/register" className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline underline-offset-4">
                  Register as any role <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link to="/verify" className="inline-flex items-center gap-1.5 font-semibold text-ink hover:underline underline-offset-4">
                  <ShieldCheck className="size-4 text-brand-green-ink" aria-hidden /> Verify a chain in your browser
                </Link>
              </div>
            </div>

            <HeroIllustration />
          </div>
        </section>

        {/* ── Proof strip ── */}
        <section aria-label="What makes a record trustworthy" className="border-y border-line bg-surface">
          <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-line md:grid-cols-4">
            {[
              { icon: Fingerprint, label: 'ed25519 signatures', sub: 'made on your device' },
              { icon: Link2, label: 'Hash-chained ledger', sub: 'append only' },
              { icon: Bitcoin, label: 'Bitcoin timestamps', sub: 'via OpenTimestamps' },
              { icon: ShieldCheck, label: 'Open verifier', sub: 'runs in any browser' },
            ].map((p) => (
              <li key={p.label} className="flex items-center gap-3 bg-surface px-4 py-5 sm:px-6">
                <p.icon className="size-6 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-ink">{p.label}</p>
                  <p className="text-xs text-ink-muted">{p.sub}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Problem ── */}
        <Section id="problem" eyebrow="The problem" title="Rejected at the border, and nobody can show why it should pass.">
          <div className="grid gap-4 md:grid-cols-3">
            {PROBLEMS.map((p) => (
              <Card key={p.title} className="p-5 sm:p-6">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary" aria-hidden>
                  <p.icon className="size-5.5" />
                </span>
                <h3 className="mt-4 font-display text-lg font-bold">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{p.body}</p>
              </Card>
            ))}
          </div>
        </Section>

        {/* ── How it works ── */}
        <Section id="how" eyebrow="How it works" title="Evidence first, then the batch moves." tone="surface">
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-xl border border-line bg-canvas p-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-primary-fg">
                    {i + 1}
                  </span>
                  <s.icon className="size-5 text-ink-muted" aria-hidden />
                </div>
                <h3 className="mt-4 font-display text-base font-bold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* ── Corridors ── */}
        <Section id="corridors" eyebrow="Pilot corridors" title="Two sesame routes, each with its own rulebook."
          intro="A corridor sets which documents each stage needs and which role must supply them. We are piloting two.">
          <div className="grid gap-4 lg:grid-cols-2">
            {CORRIDORS.map((c) => (
              <Card key={c.code} className="flex flex-col p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="outline" className="font-mono">{c.code}</Badge>
                  <Badge variant="warning">Pilot</Badge>
                </div>
                <h3 className="mt-4 flex items-center gap-2 font-display text-xl font-bold">
                  {c.from} <ArrowRight className="size-5 text-primary" aria-label="to" /> {c.to}
                </h3>
                <p className="mt-1 text-sm text-ink-muted">{c.summary}</p>
                <ul className="mt-5 flex flex-col gap-4">
                  {c.gates.map((g) => (
                    <li key={g.stage} className="rounded-lg bg-surface-muted p-3.5">
                      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-muted">
                        <Lock className="size-3.5" aria-hidden /> Before {g.stage.toLowerCase()}
                      </p>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {g.items.map((it) => (
                          <li key={it} className="flex items-start gap-2 text-sm text-ink">
                            <Check className="mt-0.5 size-4 shrink-0 text-brand-green-ink" aria-hidden /> {it}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </Section>

        {/* ── Try it ── */}
        <Section id="roles" eyebrow="Try it" title="Register as any role." tone="surface"
          intro="Pick the part of the supply chain you work in. Each role has its own permissions and its own view of the batches it handles.">
          <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
            {SELF_REGISTER_ROLES.map((r) => {
              const m = ROLE_META[r];
              return (
                <li key={r}>
                  <Link to={`/register?role=${r}`}
                    className="group flex h-full items-start gap-3 rounded-xl border border-line bg-canvas p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-surface hover:shadow-card">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: m.color }} aria-hidden>
                      <m.icon className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 font-display font-bold text-ink">
                        {m.label}
                        <ArrowRight className="size-4 text-primary opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                      </span>
                      <span className="mt-0.5 block text-sm leading-snug text-ink-muted">{m.blurb}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>

        {/* ── Live traces ── */}
        <Section id="demo" eyebrow="See it live" title="Open a batch and check it yourself.">
          <Card className="overflow-hidden">
            <div className="grid gap-0 md:grid-cols-[1fr_auto]">
              <div className="p-5 sm:p-6">
                {DEMO_TRACES.length > 0 ? (
                  <>
                    <p className="text-sm text-ink-muted">Demo batches recorded through the real signed flow. Open one on your phone:</p>
                    <ul className="mt-4 flex flex-col gap-2">
                      {DEMO_TRACES.map((d) => (
                        <li key={d.id}>
                          <Link to={`/trace/${encodeURIComponent(d.id)}`}
                            className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-line px-4 py-2 hover:border-primary/40 hover:bg-primary-soft/40">
                            <span className="min-w-0">
                              <span className="block font-mono text-sm font-semibold text-ink">{d.id}</span>
                              {d.label && <span className="block truncate text-xs text-ink-muted">{d.label}</span>}
                            </span>
                            <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
                    <p className="text-ink">Every ATiMs batch carries a QR label that opens its public trace page.</p>
                    <p className="mt-2 text-sm text-ink-muted">
                      Enter a trace ID above, or paste a batch into the verifier to recompute every hash and signature on your own device.
                    </p>
                  </>
                )}
              </div>
              <div className="flex flex-col justify-center gap-2 border-t border-line bg-surface-muted p-5 sm:p-6 md:border-l md:border-t-0">
                <Button asChild variant="outline"><Link to="/trace"><QrCode aria-hidden /> Open trace lookup</Link></Button>
                <Button asChild variant="outline"><Link to="/verify"><ShieldCheck aria-hidden /> Open the verifier</Link></Button>
              </div>
            </div>
          </Card>
        </Section>

        {/* ── CTA ── */}
        <section className="px-4 pb-16 sm:px-6">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl bg-primary px-6 py-10 text-white sm:px-10 sm:py-14">
            <div aria-hidden className="absolute -right-16 -top-16 size-64 rotate-45 rounded-[3rem] bg-white/10" />
            <div className="relative max-w-2xl">
              <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Ready to trace your next shipment?</h2>
              <p className="mt-3 text-white/90">Create an account for your role and record your first batch today.</p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                <Button asChild variant="inverse" size="lg"><Link to="/register">Create an account <ArrowRight aria-hidden /></Link></Button>
                <Button asChild size="lg" className="border border-white/40 bg-transparent hover:bg-white/10">
                  <Link to="/login">Log in</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <BrandLockup sub={false} />
            <p className="mt-2 text-sm text-ink-muted">Agro-Trace Integrated Management System by Sprezz Integrated Limited, Abuja, Nigeria.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-ink-muted">
            <Link to="/trace" className="hover:text-ink">Trace</Link>
            <Link to="/verify" className="hover:text-ink">Verify</Link>
            <Link to="/login" className="hover:text-ink">Log in</Link>
            <Link to="/register" className="hover:text-ink">Register</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function Section({ id, eyebrow, title, intro, tone = 'canvas', children }:
  { id: string; eyebrow: string; title: string; intro?: string; tone?: 'canvas' | 'surface'; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('scroll-mt-16 px-4 py-16 sm:px-6 lg:py-24', tone === 'surface' && 'bg-surface')}>
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-bold uppercase tracking-widest text-primary">{eyebrow}</p>
        <h2 id={`${id}-title`} className="mt-2 max-w-3xl font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{title}</h2>
        {intro && <p className="mt-3 max-w-2xl text-ink-muted">{intro}</p>}
        <div className="mt-8 lg:mt-10">{children}</div>
      </div>
    </section>
  );
}

/** An example trace card, drawn in HTML. Clearly labelled as an example. */
function HeroIllustration() {
  const stages = [
    { name: 'Harvested', who: 'Farmer, Kano', done: true },
    { name: 'Aggregated', who: 'Aggregator, Kaduna', done: true },
    { name: 'Packed', who: 'Lab report and packhouse log on file', done: true },
    { name: 'Exported', who: 'Waiting for phytosanitary certificate', done: false },
  ];
  return (
    <figure className="relative mx-auto w-full max-w-md lg:max-w-none" aria-label="Example of a batch trace">
      <div aria-hidden className="absolute -inset-4 -z-10 rotate-2 rounded-3xl bg-primary/10" />
      <Card className="p-5 shadow-raised sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Example batch</p>
            <p className="mt-1 font-mono text-sm font-bold text-ink">CROP-2026-000042</p>
            <p className="text-sm text-ink-muted">Sesame seed, 12.5 t</p>
          </div>
          <Badge variant="outline" className="font-mono">NG-EU-SESAME</Badge>
        </div>

        <ol className="mt-5 flex flex-col">
          {stages.map((s, i) => (
            <li key={s.name} className="relative flex gap-3 pb-4 last:pb-0">
              {i < stages.length - 1 && (
                <span aria-hidden className={cn('absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-0.5', s.done ? 'bg-brand-green' : 'bg-line')} />
              )}
              <span className={cn('relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full',
                s.done ? 'bg-brand-green text-white' : 'border-2 border-brand-yellow bg-brand-yellow-soft text-brand-yellow-ink')}>
                {s.done ? <Check className="size-4" aria-hidden /> : <Timer className="size-3.5" aria-hidden />}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm font-semibold text-ink">
                  {s.name}<span className="sr-only">{s.done ? ', passed' : ', blocked'}</span>
                </p>
                <p className="text-xs text-ink-muted">{s.who}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          <Badge variant="success"><BadgeCheck aria-hidden /> Signatures valid</Badge>
          <Badge variant="info"><Link2 aria-hidden /> Chain intact</Badge>
          <Badge variant="purple"><ClipboardList aria-hidden /> 1 gate open</Badge>
        </div>
      </Card>
      <figcaption className="sr-only">Illustration only. Not a real batch.</figcaption>
    </figure>
  );
}

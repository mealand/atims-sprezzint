/**
 * ATiMs live demo seed.
 *
 *   npx tsx scripts/seed-demo.ts --api http://localhost:3000
 *   npx tsx scripts/seed-demo.ts --api https://atims-sprezzint-production.up.railway.app
 *
 * Drives the real public API exactly as the browser does. Nothing is written to the
 * database directly:
 *   1. registers a DEMO account for every role (two buyers: EU and UAE),
 *   2. confirms each email with the 6-digit code (the `dev_code` in the response when
 *      the API has no RESEND_API_KEY; otherwise you are asked to type the emailed code),
 *   3. creates three batches and moves them with ed25519-signed events
 *      (dry-run, sign the exact wire event, submit) and signed handover acceptances,
 *   4. prints the three public trace URLs and checks each chain independently.
 *
 * Batches:
 *   eu       NG-EU-SESAME, lab report, inspector phyto, export declaration and
 *            certificate of origin, taken to DELIVERED (the last stage the corridor defines).
 *   uae      NG-AE-SESAME, taken to DELIVERED after the named buyer's DELIVERY_CONFIRMED.
 *   blocked  NG-EU-SESAME, stopped at the PACKED gate because the lab report is missing.
 *
 * Safe to rerun: credentials, device keys and batch ids are kept per API URL in
 * scripts/.demo-credentials.json (gitignored). A rerun logs in with them and only
 * performs the steps a batch has not done yet. Use --fresh for three new batches.
 *
 * Options:
 *   --api <url>            API base URL (required)
 *   --app <url>            frontend base URL for the printed links
 *                          (default: http://localhost:5173 for a local API, else https://atims.sprezzint.com)
 *   --out <file>           credentials file (default scripts/.demo-credentials.json)
 *   --tag <word>           a second, separate set of demo accounts (emails and registration numbers get the tag)
 *   --email-pattern <p>    where codes go, e.g. "ops+{key}@sprezzint.com" ({key} is farmer, buyer-eu, ...)
 *                          default: demo-{key}@demo.sprezzint.com
 *   --fresh                create three new batches even if earlier ones exist
 */
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { deflateSync } from 'node:zlib';
import * as ed from '@noble/ed25519';
import { canonicalize, verifyChainIndependent, type VerifyEvent } from '@atims/shared';

// ── Types ──────────────────────────────────────────────────

export type AccountKey =
  | 'farmer' | 'aggregator' | 'processor' | 'exporter' | 'lab' | 'inspector' | 'buyer-eu' | 'buyer-ae' | 'regulator';
export type BatchKey = 'eu' | 'uae' | 'blocked';

export interface SeedOptions {
  api: string;
  app?: string;
  out?: string;
  tag?: string;
  emailPattern?: string;
  fresh?: boolean;
  /** Log sink (default console.log). */
  log?: (line: string) => void;
  /** Asks for an emailed code when the API did not return a dev_code. Default: read from stdin. */
  promptCode?: (email: string) => Promise<string>;
}

interface StoredAccount {
  role: string; name: string; email: string; password: string;
  id?: string; nexus_id?: string;
  /** Device signing key seed (hex). Same role as the browser's localStorage key. */
  device_seed: string;
}
interface StoredBatch { id: string; trace_id: string }
interface EnvState {
  updated_at?: string;
  accounts: Partial<Record<AccountKey, StoredAccount>>;
  batches: Partial<Record<BatchKey, StoredBatch>>;
}
type CredentialsFile = Record<string, EnvState>;

interface Session { key: AccountKey; id: string; nexus_id: string; role: string; token: string; seed: string; pubkey: string }

export interface SeedResult {
  app: string;
  accounts: Record<AccountKey, { id: string; nexus_id: string; email: string; role: string }>;
  batches: Record<BatchKey, { id: string; trace_id: string; url: string; stage: string; chain_valid: boolean }>;
  credentials_file: string;
}

// ── HTTP ───────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(readonly status: number, readonly data: Record<string, unknown>, method: string, path: string) {
    super(`${method} ${path} -> ${status}: ${String(data.error ?? data.message ?? 'request failed')}${data.code ? ` (${String(data.code)})` : ''}`);
  }
  get code(): string | undefined { return this.data.code as string | undefined; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function client(base: string, log: (s: string) => void) {
  const root = base.replace(/\/+$/, '');
  return async function call<T = Record<string, unknown>>(
    method: string, path: string, opts: { body?: unknown; token?: string } = {},
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${root}${path}`, {
          method,
          headers: {
            ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        });
      } catch (err) {
        if (attempt >= 4) throw err;
        await sleep(1000 * attempt);
        continue;
      }
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 429 && attempt < 8) {
        const wait = Math.max(1, Number(res.headers.get('retry-after') ?? data.retry_after_s ?? 10));
        log(`  rate limited on ${method} ${path}; waiting ${wait}s`);
        await sleep(wait * 1000 + 250);
        continue;
      }
      if (!res.ok) throw new ApiError(res.status, data, method, path);
      return data as T;
    }
  };
}
type Call = ReturnType<typeof client>;

// ── Keys and signing (same as frontend/src/lib/keys.ts) ───

const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

async function pubkeyOf(seedHex: string): Promise<string> {
  return b64(await ed.getPublicKeyAsync(Buffer.from(seedHex, 'hex')));
}

async function signCanonical(payload: unknown, seedHex: string): Promise<string> {
  const msg = new TextEncoder().encode(canonicalize(payload));
  return b64(await ed.signAsync(msg, Buffer.from(seedHex, 'hex')));
}

interface WireEvent { seq: number; created_at: string; [k: string]: unknown }

/** frontend/src/lib/events.ts appendSignedEvent: dry-run, sign the exact wire event, submit. */
async function appendSignedEvent(
  call: Call, s: Session, batchId: string,
  body: { event_type: string; to_stage?: string; payload: Record<string, unknown> },
) {
  for (let attempt = 1; ; attempt++) {
    const dry = await call<{ wire_event: WireEvent }>('POST', `/batches/${batchId}/events`, {
      token: s.token, body: { ...body, actor_pubkey: s.pubkey, dry_run: true },
    });
    const actor_sig = await signCanonical(dry.wire_event, s.seed);
    try {
      return await call('POST', `/batches/${batchId}/events`, {
        token: s.token,
        body: {
          ...body, actor_pubkey: s.pubkey, actor_sig,
          created_at: dry.wire_event.created_at, seq: dry.wire_event.seq,
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STALE_EVENT' && attempt < 3) continue;
      throw err;
    }
  }
}

/** Holder starts a handover; the receiver previews it and accepts with a signed CUSTODY_TRANSFER. */
async function handover(call: Call, from: Session, to: Session, batchId: string) {
  const started = await call<{ token: string }>('POST', `/batches/${batchId}/handover/start`, { token: from.token });
  await call('GET', `/handover/${encodeURIComponent(started.token)}`, { token: to.token });
  const path = `/handover/${encodeURIComponent(started.token)}/accept`;
  const dry = await call<{ wire_event: WireEvent }>('POST', path, {
    token: to.token, body: { actor_pubkey: to.pubkey, dry_run: true },
  });
  const actor_sig = await signCanonical(dry.wire_event, to.seed);
  return call('POST', path, {
    token: to.token,
    body: { actor_pubkey: to.pubkey, actor_sig, created_at: dry.wire_event.created_at, seq: dry.wire_event.seq },
  });
}

// ── Generated evidence files ───────────────────────────────

/** A minimal one-page PDF with a few lines of ASCII text. */
export function makePdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, (m) => `\\${m}`);
  const text = ['BT', '/F1 12 Tf', '16 TL', '56 790 Td', ...lines.map((l) => `(${esc(l)}) '`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A small PNG "photo": a sesame-coloured field with a crimson band, varied by `salt` so each hash differs. */
export function makePng(salt: string, size = 48): Uint8Array {
  const h = createHash('sha256').update(salt).digest();
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const band = y > size * 0.7;
      const noise = h[(x * 7 + y * 13) % h.length] % 24;
      const [r, g, b] = band ? [168, 29, 29] : [222 - noise, 196 - noise, 140 - noise];
      row.set([r, g, b], 1 + x * 3);
    }
    rows.push(row);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]));
}

const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Browser flow (dashboards/shared.tsx): hash locally, ask for an upload URL, PUT if storage is on, register. */
async function addEvidence(
  call: Call, s: Session, batchId: string, evidenceType: string,
  file: { bytes: Uint8Array; name: string; mime: string }, meta: Record<string, unknown> = {},
): Promise<{ stored: boolean }> {
  const file_hash = sha256Hex(file.bytes);
  const up = await call<{ upload_url: string | null; storage_enabled: boolean }>(
    'POST', `/batches/${batchId}/evidence/upload-url`, { token: s.token, body: { file_hash, evidence_type: evidenceType } },
  );
  let stored = false;
  if (up.storage_enabled && up.upload_url) {
    try {
      const put = await fetch(up.upload_url, { method: 'PUT', body: file.bytes as unknown as BodyInit });
      stored = put.ok;
    } catch {
      stored = false; // storage unreachable: fall back to hash-only, as the browser does
    }
  }
  await call('POST', `/batches/${batchId}/evidence`, {
    token: s.token,
    body: { evidence_type: evidenceType, file_hash, stored, meta: { file_name: file.name, size: file.bytes.length, mime: file.mime, ...meta } },
  });
  return { stored };
}

// ── Accounts ───────────────────────────────────────────────

const ACCOUNT_KEYS: AccountKey[] = ['farmer', 'aggregator', 'processor', 'exporter', 'lab', 'inspector', 'buyer-eu', 'buyer-ae', 'regulator'];

/** Deterministic per tag, so two tags never collide on a registration number. */
function digits(tag: string, key: string, n: number): string {
  const h = createHash('sha256').update(`atims-demo:${tag}:${key}`).digest();
  let s = '';
  for (let i = 0; s.length < n; i++) s += String(h[i % h.length] % 10);
  return s;
}

export function demoRegistration(key: AccountKey, tag: string, emailPattern: string) {
  const t = tag ? ` ${tag.toUpperCase()}` : '';
  const email = emailPattern.replace('{key}', tag ? `${key}-${tag}` : key).toLowerCase();
  const password = randomBytes(18).toString('base64url');
  const ref = (prefix: string) => `${prefix}${digits(tag, key, 6)}`;
  const base = { email, password };
  switch (key) {
    case 'farmer':
      return { ...base, role: 'farmer', name: `DEMO Hauwa Sesame Farm${t}`, profile: {
        phone: `+23480${digits(tag, key, 8)}`, state: 'Jigawa', lga: 'Dutse', farm_gps: { lat: 11.7564, lng: 9.3388 },
        farm_size_ha: 4.5, crops: ['sesame'], cooperative: 'DEMO Dutse Sesame Growers Cooperative',
      } };
    case 'aggregator':
      return { ...base, role: 'aggregator', name: `DEMO Kano Sesame Aggregators${t}`, profile: {
        cac_number: `RC${digits(tag, key, 7)}`, warehouse_location: { address: 'DEMO Warehouse 4, Dawanau Grain Market', state: 'Kano' },
      } };
    case 'processor':
      return { ...base, role: 'processor', name: `DEMO Kaduna Clean Seed Processing${t}`, profile: {
        cac_number: `RC${digits(tag, key, 7)}`, warehouse_location: { address: 'DEMO Packhouse 2, Kakuri Industrial Estate', state: 'Kaduna' },
      } };
    case 'exporter':
      return { ...base, role: 'exporter', name: `DEMO Lagos Agro Exports${t}`, profile: {
        cac_number: `RC${digits(tag, key, 7)}`, nepc_number: ref('NEPC/EXP/DEMO/'), tin: `${digits(tag, `${key}tin`, 8)}-0001`,
      } };
    case 'lab':
      return { ...base, role: 'lab', name: `DEMO Abuja Food Safety Laboratory${t}`, profile: {
        iso17025_accreditation_number: ref('ISO17025-DEMO-'), accreditation_body: 'DEMO accreditation body',
      } };
    case 'inspector':
      return { ...base, role: 'inspector', name: `DEMO Plant Quarantine Inspector${t}`, profile: {
        organisation: 'DEMO Plant Inspection Service', staff_id: ref('DEMO-INS-'),
      } };
    case 'buyer-eu':
      return { ...base, role: 'buyer', name: `DEMO Rotterdam Seeds Import BV${t}`, profile: { company: 'DEMO Rotterdam Seeds Import BV', country: 'NL' } };
    case 'buyer-ae':
      return { ...base, role: 'buyer', name: `DEMO Dubai Tahini Trading LLC${t}`, profile: { company: 'DEMO Dubai Tahini Trading LLC', country: 'AE' } };
    case 'regulator':
      return { ...base, role: 'regulator', name: `DEMO Export Oversight Desk${t}`, profile: {
        agency: 'DEMO Export Oversight Agency', staff_id: ref('DEMO-REG-'),
      } };
  }
}

/** One line reader for the whole run, so codes piped on stdin are not lost between prompts. */
let lines: { next: () => Promise<string | undefined> } | null = null;
function stdinLines() {
  if (lines) return lines;
  const rl = createInterface({ input: process.stdin, terminal: false });
  const queue: string[] = [];
  const waiting: Array<(l: string | undefined) => void> = [];
  let closed = false;
  rl.on('line', (l) => { const w = waiting.shift(); if (w) w(l); else queue.push(l); });
  rl.on('close', () => { closed = true; for (const w of waiting.splice(0)) w(undefined); });
  lines = {
    next: () => (queue.length ? Promise.resolve(queue.shift()) : closed ? Promise.resolve(undefined) : new Promise((r) => waiting.push(r))),
  };
  return lines;
}

async function stdinCode(email: string): Promise<string> {
  process.stdout.write(`  Enter the 6-digit code emailed to ${email}: `);
  const line = await stdinLines().next();
  if (line === undefined) throw new Error(`no code entered for ${email}; rerun the script to get a new code`);
  if (!process.stdin.isTTY) process.stdout.write('\n');
  return line.trim();
}

interface Delivery { delivered?: boolean; dev_code?: string; error?: string }

async function ensureAccount(
  call: Call, key: AccountKey, state: EnvState, opts: Required<Pick<SeedOptions, 'tag' | 'emailPattern'>> & {
    log: (s: string) => void; promptCode: (email: string) => Promise<string>; save: () => void;
  },
): Promise<Session> {
  const { log } = opts;
  let stored = state.accounts[key];
  type AuthOut = { token?: string; entity: { id: string; nexus_id: string; role: string } };

  const askCode = async (email: string, delivery: Delivery | undefined): Promise<string> => {
    if (delivery?.dev_code) return delivery.dev_code;
    if (delivery?.error) {
      throw new Error(`the API could not send the verification email to ${email} (${delivery.error}). `
        + 'Check RESEND_API_KEY and EMAIL_FROM on the API, then rerun this script: it resends the code.');
    }
    log(`  This API sends real email (RESEND_API_KEY is set), so no dev_code was returned.`);
    log(`  The code went to ${email}. If that mailbox does not exist, stop now (Ctrl+C) and rerun with`);
    log(`  --email-pattern "you+{key}@yourdomain.com" so the codes reach an inbox you can read.`);
    return opts.promptCode(email);
  };

  const verify = async (email: string, delivery: Delivery | undefined): Promise<AuthOut> => {
    for (let attempt = 1; ; attempt++) {
      const code = await askCode(email, delivery);
      try {
        return await call<AuthOut>('POST', '/auth/verify-email', { body: { email, code } });
      } catch (err) {
        if (!(err instanceof ApiError) || attempt >= 3) throw err;
        if (err.code === 'WRONG_CODE' && !delivery?.dev_code) { log('  that code was not accepted; try again'); continue; }
        if (err.code === 'CODE_EXPIRED' || err.code === 'CODE_USED' || err.code === 'TOO_MANY_ATTEMPTS' || err.code === 'NO_CODE') {
          delivery = await resend(email);
          continue;
        }
        throw err;
      }
    }
  };

  const resend = async (email: string): Promise<Delivery> => {
    for (;;) {
      try {
        return await call<Delivery>('POST', '/auth/resend-code', { body: { email } });
      } catch (err) {
        if (err instanceof ApiError && err.status === 429 && err.data.retry_after_s) {
          log(`  waiting ${Number(err.data.retry_after_s)}s before a new code can be issued`);
          await sleep(Number(err.data.retry_after_s) * 1000 + 500);
          continue;
        }
        throw err;
      }
    }
  };

  let out: AuthOut;
  if (stored) {
    try {
      out = await call<AuthOut>('POST', '/auth/login', { body: { email: stored.email, password: stored.password } });
      log(`  ${key}: logged in as ${stored.email}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_UNVERIFIED') {
        log(`  ${key}: registered earlier but email not confirmed; requesting a new code`);
        out = await verify(stored.email, await resend(stored.email));
      } else if (err instanceof ApiError && err.status === 401) {
        throw new Error(`${key}: the stored password for ${stored.email} was rejected. Was the account changed by hand? `
          + 'Rerun with --tag <word> to create a separate set of demo accounts.');
      } else throw err;
    }
  } else {
    const reg = demoRegistration(key, opts.tag, opts.emailPattern);
    let created: { entity: { id: string; nexus_id: string }; verification?: Delivery };
    try {
      created = await call('POST', '/auth/register', { body: reg });
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'EMAIL_TAKEN' || err.code === 'IDENTIFIER_TAKEN' || err.code === 'ALREADY_REGISTERED')) {
        throw new Error(`${key}: ${reg.email} (or its registration number) is already registered on this API, but its `
          + `password is not in the credentials file. Restore the file, or rerun with --tag <word> for a new set of demo accounts.`);
      }
      throw err;
    }
    stored = {
      role: reg.role, name: reg.name, email: reg.email, password: reg.password,
      id: created.entity.id, nexus_id: created.entity.nexus_id, device_seed: toHex(ed.utils.randomPrivateKey()),
    };
    state.accounts[key] = stored;
    opts.save(); // keep the password even if the code step fails
    log(`  ${key}: registered ${reg.email} (${created.entity.nexus_id})`);
    out = await verify(reg.email, created.verification);
    log(`  ${key}: email confirmed, self verified`);
  }
  if (!out.token) throw new Error(`${key}: no session token returned; is the account suspended?`);
  stored.id = out.entity.id;
  stored.nexus_id = out.entity.nexus_id;
  opts.save();
  return {
    key, id: out.entity.id, nexus_id: out.entity.nexus_id, role: out.entity.role, token: out.token,
    seed: stored.device_seed, pubkey: await pubkeyOf(stored.device_seed),
  };
}

// ── Batch plans ────────────────────────────────────────────

interface BatchView {
  batch: { id: string; trace_id: string; current_stage: string; current_holder_id: string };
  events: Array<{ event_type: string; actor_id: string; to_stage: string | null }>;
  evidence: Array<{ evidence_type: string; actor_id: string }>;
  assignments: Array<{ entity_id: string }>;
}

interface Step {
  label: string;
  done: (v: BatchView) => boolean;
  run: (batchId: string, traceId: string) => Promise<unknown>;
}

const STAGE_ORDER = ['HARVESTED', 'AGGREGATED', 'PACKED', 'IN_TRANSIT', 'AT_PORT', 'EXPORTED', 'DELIVERED'];
const atLeast = (v: BatchView, stage: string) => STAGE_ORDER.indexOf(v.batch.current_stage) >= STAGE_ORDER.indexOf(stage);

function planFor(key: BatchKey, call: Call, a: Record<AccountKey, Session>, log: (s: string) => void): Step[] {
  const hand = (from: AccountKey, to: AccountKey): Step => ({
    label: `handover ${from} -> ${to}`,
    done: (v) => v.events.some((e) => e.event_type === 'CUSTODY_TRANSFER' && e.actor_id === a[to].id),
    run: (id) => handover(call, a[from], a[to], id),
  });
  const advance = (by: AccountKey, stage: string): Step => ({
    label: `${by} advances to ${stage}`,
    done: (v) => atLeast(v, stage),
    run: (id) => appendSignedEvent(call, a[by], id, { event_type: 'STAGE_ADVANCE', to_stage: stage, payload: { note: `DEMO: ${stage.toLowerCase().replace('_', ' ')}` } }),
  });
  const assign = (by: AccountKey, who: AccountKey): Step => ({
    label: `${by} assigns the ${who}`,
    done: (v) => v.assignments.some((x) => x.entity_id === a[who].id),
    run: (id) => call('POST', `/batches/${id}/assignments`, { token: a[by].token, body: { nexus_id: a[who].nexus_id } }),
  });
  const doc = (by: AccountKey, type: string, kind: 'pdf' | 'png', lines: (traceId: string) => string[], meta: Record<string, unknown> = {}): Step => ({
    label: `${by} adds ${type}`,
    done: (v) => v.evidence.some((e) => e.evidence_type === type && e.actor_id === a[by].id),
    run: async (id, traceId) => {
      const body = lines(traceId);
      const file = kind === 'pdf'
        ? { bytes: makePdf(['ATiMs DEMO DOCUMENT. NOT A REAL CERTIFICATE.', '', ...body, '', `Generated ${new Date().toISOString()}`]), name: `${type.toLowerCase()}-${traceId}.pdf`, mime: 'application/pdf' }
        : { bytes: makePng(`${traceId}:${type}:${Date.now()}`), name: `${type.toLowerCase()}-${traceId}.png`, mime: 'image/png' };
      const r = await addEvidence(call, a[by], id, type, file, { note: 'DEMO document generated by scripts/seed-demo.ts', ...meta });
      log(`      ${r.stored ? 'file stored and hash recorded' : 'hash recorded (storage not configured)'}`);
    },
  });
  const signoff = (): Step => ({
    label: 'inspector signs off (approved)',
    done: (v) => v.events.some((e) => e.event_type === 'INSPECTION_SIGNOFF'),
    run: (id) => appendSignedEvent(call, a.inspector, id, { event_type: 'INSPECTION_SIGNOFF', payload: { decision: 'approved', note: 'DEMO: consignment inspected, phytosanitary certificate issued' } }),
  });

  const ref = (traceId: string, p: string) => `${p}-${traceId}`;
  const front: Step[] = [
    hand('farmer', 'aggregator'),
    advance('aggregator', 'AGGREGATED'),
    hand('aggregator', 'processor'),
    doc('processor', 'PHOTO', 'png', () => []),
    doc('processor', 'PACKHOUSE_LOG', 'pdf', (t) => [`Packhouse log for batch ${t}`, 'Cleaned, sorted and bagged in 50 kg bags.', 'Moisture 5.8 percent. Purity 99.5 percent.']),
  ];
  const labReport = doc('lab', 'LAB_REPORT', 'pdf', (t) => [
    `Laboratory report ${ref(t, 'LAB')}`, 'Pesticide residues (MRL): within EU limits', 'Aflatoxin B1 and total: within EU limits', 'Ethylene oxide: not detected',
  ], { analytes: ['MRL', 'AFLATOXIN', 'ETHYLENE_OXIDE'], results: { mrl: 'pass', aflatoxin: 'pass', ethylene_oxide: 'pass' } });
  const exportDocs = (buyer: AccountKey): Step[] => [
    hand('processor', 'exporter'),
    advance('exporter', 'IN_TRANSIT'),
    advance('exporter', 'AT_PORT'),
    assign('exporter', 'inspector'),
    doc('inspector', 'PHYTOSANITARY_CERT', 'pdf', (t) => [`Phytosanitary certificate ${ref(t, 'PHYTO')}`, 'Consignment inspected and found free of quarantine pests.']),
    signoff(),
    doc('exporter', 'EXPORT_DECLARATION', 'pdf', (t) => [`Export declaration ${ref(t, 'NXP')}`, 'Commodity: sesame seed, HS 1207.40']),
    doc('exporter', 'CERTIFICATE_OF_ORIGIN', 'pdf', (t) => [`Certificate of origin ${ref(t, 'COO')}`, 'Country of origin: Nigeria']),
    advance('exporter', 'EXPORTED'),
    hand('exporter', buyer),
  ];

  switch (key) {
    case 'eu':
      return [...front, assign('processor', 'lab'), labReport, advance('processor', 'PACKED'), ...exportDocs('buyer-eu'), advance('buyer-eu', 'DELIVERED')];
    case 'uae':
      return [...front, advance('processor', 'PACKED'), ...exportDocs('buyer-ae'), {
        label: 'buyer confirms delivery (DELIVERY_CONFIRMED)',
        done: (v) => v.events.some((e) => e.event_type === 'DELIVERY_CONFIRMED'),
        run: (id) => appendSignedEvent(call, a['buyer-ae'], id, { event_type: 'DELIVERY_CONFIRMED', payload: { note: 'DEMO: received in Jebel Ali in good condition' } }),
      }, advance('buyer-ae', 'DELIVERED')];
    case 'blocked':
      return [...front, assign('processor', 'lab'), {
        label: 'processor tries to advance to PACKED (blocked: no lab report)',
        done: (v) => v.events.some((e) => e.event_type === 'GATE_REJECTED' && e.to_stage === 'PACKED'),
        run: async (id) => {
          // What the browser shows first: the dry-run answers 422 with the gate report and writes nothing.
          try {
            await appendSignedEvent(call, a.processor, id, { event_type: 'STAGE_ADVANCE', to_stage: 'PACKED', payload: { note: 'DEMO: attempt to pack' } });
            throw new Error('expected the PACKED gate to block this batch, but it passed');
          } catch (err) {
            if (!(err instanceof ApiError) || err.code !== 'GATE_FAILED') throw err;
          }
          // A submitted attempt is recorded on the chain as GATE_REJECTED, so the trace shows the block.
          try {
            await call('POST', `/batches/${id}/events`, {
              token: a.processor.token,
              body: { event_type: 'STAGE_ADVANCE', to_stage: 'PACKED', payload: { note: 'DEMO: attempt to pack' }, actor_pubkey: a.processor.pubkey },
            });
            throw new Error('expected the PACKED gate to block this batch, but it passed');
          } catch (err) {
            if (!(err instanceof ApiError) || err.code !== 'GATE_FAILED') throw err;
            const gate = err.data.gate as { missing_evidence?: string[] } | undefined;
            log(`      gate failed as intended; missing: ${(gate?.missing_evidence ?? []).join(', ')}`);
          }
        },
      }];
  }
}

const BATCH_SPEC: Record<BatchKey, { corridor: string; buyer: AccountKey; title: string; quantity: number; target: string }> = {
  eu: { corridor: 'NG-EU-SESAME', buyer: 'buyer-eu', title: 'Sesame to Rotterdam (EU), delivered', quantity: 24000, target: 'DELIVERED' },
  uae: { corridor: 'NG-AE-SESAME', buyer: 'buyer-ae', title: 'Sesame to Dubai (UAE), delivery confirmed', quantity: 18000, target: 'DELIVERED' },
  blocked: { corridor: 'NG-EU-SESAME', buyer: 'buyer-eu', title: 'Sesame to the EU, blocked at packing: no lab report', quantity: 12000, target: 'AGGREGATED' },
};

// ── Main flow ──────────────────────────────────────────────

/** This file's path. The repo root is CommonJS, so tsx runs this file as CJS (no import.meta). */
const selfPath: string = typeof __filename === 'string' ? __filename : resolve('scripts/seed-demo.ts');
const here = dirname(selfPath);

function defaultApp(api: string): string {
  const host = new URL(api).hostname;
  return host === 'localhost' || host === '127.0.0.1' ? 'http://localhost:5173' : 'https://atims.sprezzint.com';
}

export async function seedDemo(options: SeedOptions): Promise<SeedResult> {
  const log = options.log ?? ((s: string) => console.log(s));
  const api = options.api.replace(/\/+$/, '');
  const app = (options.app ?? defaultApp(api)).replace(/\/+$/, '');
  const out = resolve(options.out ?? join(here, '.demo-credentials.json'));
  const tag = (options.tag ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const emailPattern = options.emailPattern ?? 'demo-{key}@demo.sprezzint.com';
  if (!emailPattern.includes('{key}')) throw new Error('--email-pattern must contain {key}');
  const call = client(api, log);

  const file: CredentialsFile = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) as CredentialsFile : {};
  const stateKey = tag ? `${api}#${tag}` : api;
  const state: EnvState = file[stateKey] ?? { accounts: {}, batches: {} };
  file[stateKey] = state;
  const save = () => {
    state.updated_at = new Date().toISOString();
    writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    try { chmodSync(out, 0o600); } catch { /* not supported on this filesystem */ }
  };

  log(`ATiMs demo seed against ${api}`);
  const health = await call<Record<string, unknown>>('GET', '/health').catch((err: Error) => {
    throw new Error(`cannot reach ${api}/health: ${err.message}`);
  });
  log(`  API healthy (${JSON.stringify(health).slice(0, 120)})`);

  log('\n1. Accounts (self-registration, email code, no admin)');
  const sessions = {} as Record<AccountKey, Session>;
  for (const key of ACCOUNT_KEYS) {
    sessions[key] = await ensureAccount(call, key, state, {
      tag, emailPattern, log, save, promptCode: options.promptCode ?? stdinCode,
    });
  }

  log('\n2. Batches');
  const results = {} as SeedResult['batches'];
  for (const key of ['eu', 'uae', 'blocked'] as BatchKey[]) {
    const spec = BATCH_SPEC[key];
    log(`\n  [${key}] ${spec.title}`);
    let ref = options.fresh ? undefined : state.batches[key];
    let view: BatchView | undefined;
    if (ref) {
      try {
        view = await call<BatchView>('GET', `/batches/${ref.id}`, { token: sessions.farmer.token });
        log(`    reusing ${ref.trace_id} (at ${view.batch.current_stage})`);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) throw err;
        log(`    stored batch ${ref.trace_id} not found on this API; creating a new one`);
        ref = undefined;
      }
    }
    if (!ref) {
      const created = await call<{ batch: { id: string; trace_id: string } }>('POST', '/batches', {
        token: sessions.farmer.token,
        body: {
          commodity: 'sesame', variety: 'white sesame, hulled', quantity: spec.quantity, unit: 'kg',
          production_date: new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10),
          origin_state: 'Jigawa', corridor: spec.corridor, buyer_nexus_id: sessions[spec.buyer].nexus_id,
          notes: `DEMO batch: ${spec.title}. Created by scripts/seed-demo.ts`,
        },
      });
      ref = { id: created.batch.id, trace_id: created.batch.trace_id };
      state.batches[key] = ref;
      save();
      log(`    created ${ref.trace_id} on ${spec.corridor}`);
      view = await call<BatchView>('GET', `/batches/${ref.id}`, { token: sessions.farmer.token });
    }
    for (const step of planFor(key, call, sessions, log)) {
      if (step.done(view!)) continue;
      log(`    - ${step.label}`);
      await step.run(ref.id, ref.trace_id);
    }

    // Check what a buyer sees: the public trace, and the raw chain verified here, not by the server.
    const trace = await call<{ batch: { current_stage: string }; server_integrity: { valid: boolean } }>('GET', `/trace/${ref.trace_id}`);
    const raw = await call<{ events: VerifyEvent[] }>('GET', `/verify/${ref.trace_id}`);
    const v = await verifyChainIndependent(raw.events);
    if (!v.valid) throw new Error(`[${key}] chain failed independent verification: ${v.problems.join('; ')}`);
    if (trace.batch.current_stage !== spec.target) {
      throw new Error(`[${key}] expected stage ${spec.target}, found ${trace.batch.current_stage}`);
    }
    log(`    at ${trace.batch.current_stage}; ${raw.events.length} events, chain verified independently`);
    results[key] = { ...ref, url: `${app}/trace/${ref.trace_id}`, stage: trace.batch.current_stage, chain_valid: v.valid };
  }
  save();

  const accounts = {} as SeedResult['accounts'];
  for (const key of ACCOUNT_KEYS) {
    const s = state.accounts[key]!;
    accounts[key] = { id: sessions[key].id, nexus_id: sessions[key].nexus_id, email: s.email, role: s.role };
  }

  log('\n3. Public trace pages (no login needed)');
  for (const key of ['eu', 'uae', 'blocked'] as BatchKey[]) log(`  ${BATCH_SPEC[key].title}\n    ${results[key].url}`);
  log('\nFor the landing page "See it live" section, set this on the frontend build:');
  log(`  VITE_DEMO_TRACES="${results.eu.trace_id}|Sesame to Rotterdam,${results.uae.trace_id}|Sesame to Dubai,${results.blocked.trace_id}|Blocked at packing"`);
  log(`\nDemo logins (email and password) are in ${out}. Keep that file private.`);
  return { app, accounts, batches: results, credentials_file: out };
}

// ── CLI ────────────────────────────────────────────────────

function parseArgs(argv: string[]): SeedOptions {
  const opts: Partial<SeedOptions> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.split(/=(.*)/s, 2);
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--api': opts.api = value(); break;
      case '--app': opts.app = value(); break;
      case '--out': opts.out = value(); break;
      case '--tag': opts.tag = value(); break;
      case '--email-pattern': opts.emailPattern = value(); break;
      case '--fresh': opts.fresh = true; break;
      case '-h': case '--help':
        console.log(readFileSync(selfPath, 'utf8').split('*/')[0]);
        process.exit(0);
        break;
      default: throw new Error(`unknown option ${arg} (try --help)`);
    }
  }
  if (!opts.api) throw new Error('--api <url> is required, e.g. --api http://localhost:3000');
  return opts as SeedOptions;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(selfPath)) {
  seedDemo(parseArgs(process.argv.slice(2))).then(
    () => process.exit(0),
    (err: Error) => {
      console.error(`\nSeed failed: ${err.message}`);
      process.exit(1);
    },
  );
}

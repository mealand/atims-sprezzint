/**
 * End-to-end: the real Fastify app (buildApp) on a real PostgreSQL database with
 * every migration applied. Nothing is mocked and nothing is written to the
 * database except through the HTTP API.
 *
 *   1. register, email code (dev_code), self-verified login, no admin step
 *   2. create a corridor batch naming its buyer
 *   3. evidence, signed stage advances, signed handovers
 *   4. buyer confirms delivery, batch reaches DELIVERED
 *   5. GET /trace and GET /verify: the chain verifies independently
 *   6. the blocked case: PACKED without a lab report fails the gate and says who must supply it
 *   7. scripts/seed-demo.ts against the listening app, twice (idempotent)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ed from '@noble/ed25519';
import { canonicalize, verifyChainIndependent, type VerifyEvent } from '@atims/shared';

let app: Awaited<ReturnType<typeof import('../../src/app.js')['buildApp']>>;
let closePool: () => Promise<void>;

beforeAll(async () => {
  const { buildApp } = await import('../../src/app.js');
  const { pool } = await import('../../src/db/pool.js');
  const { logger } = await import('../../src/utils/logger.js');
  logger.level = process.env.INTEGRATION_LOG_LEVEL ?? 'warn'; // keep CI output readable
  app = await buildApp();
  await app.ready();
  closePool = () => pool.end();
});

afterAll(async () => {
  await app?.close();
  await closePool?.();
});

// ── Client helpers: what the browser does ─────────────────

/** Each test client gets its own address, so per-IP rate limits never couple tests. */
let nextIp = 10;
interface Res { status: number; body: Record<string, any> }

function clientFor(ip = `10.0.0.${nextIp++}`) {
  return async (method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown } = {}): Promise<Res> => {
    const res = await app.inject({
      method, url, remoteAddress: ip,
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : {} };
  };
}
const http = clientFor('10.0.0.1');

interface Actor { id: string; nexus_id: string; role: string; token: string; seed: Uint8Array; pubkey: string }

async function signWire(wire: unknown, seed: Uint8Array): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(canonicalize(wire)), seed)).toString('base64');
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const tag = randomBytes(3).toString('hex');
let seq = 1000;
const n = (len: number) => String(seq++).padStart(len, '7');

function registration(role: string) {
  const email = `it-${role}-${tag}@integration.test`;
  const base = { role, email, password: 'integration-pass-123', name: `IT ${role} ${tag}` };
  switch (role) {
    case 'farmer': return { ...base, profile: { phone: '+2348031234567', state: 'Jigawa', lga: 'Dutse', farm_gps: { lat: 11.75, lng: 9.33 }, farm_size_ha: 3, crops: ['sesame'] } };
    case 'aggregator':
    case 'processor': return { ...base, profile: { cac_number: `RC${n(7)}`, warehouse_location: { address: 'Plot 1, Test Road', state: 'Kano' } } };
    case 'exporter': return { ...base, profile: { cac_number: `RC${n(7)}`, nepc_number: `NEPC/IT/${n(6)}`, tin: `${n(8)}-0001` } };
    case 'inspector': return { ...base, profile: { organisation: 'IT Inspection Service', staff_id: `IT-${n(6)}` } };
    case 'buyer': return { ...base, profile: { company: 'IT Buyer LLC', country: 'AE' } };
    default: throw new Error(role);
  }
}

/** Register, read the dev_code, confirm the email, and hold a device key. */
async function signUp(role: string): Promise<Actor> {
  const reg = registration(role);
  const r = await http('POST', '/auth/register', { body: reg });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(r.body.entity.trust_tier).toBe('registered');
  const code = r.body.verification.dev_code as string;
  expect(code).toMatch(/^\d{6}$/);

  const early = await http('POST', '/auth/login', { body: { email: reg.email, password: reg.password } });
  expect(early.status).toBe(403);
  expect(early.body.code).toBe('EMAIL_UNVERIFIED');

  const v = await http('POST', '/auth/verify-email', { body: { email: reg.email, code } });
  expect(v.status, JSON.stringify(v.body)).toBe(200);
  expect(v.body.entity.trust_tier).toBe('self_verified');
  const seed = ed.utils.randomPrivateKey();
  return {
    id: v.body.entity.id, nexus_id: v.body.entity.nexus_id, role, token: v.body.token, seed,
    pubkey: Buffer.from(await ed.getPublicKeyAsync(seed)).toString('base64'),
  };
}

/** Dry-run, sign the exact wire event, submit with the echoed created_at and seq. */
async function signedEvent(a: Actor, batchId: string, body: { event_type: string; to_stage?: string; payload: Record<string, unknown> }): Promise<Res> {
  const dry = await http('POST', `/batches/${batchId}/events`, { token: a.token, body: { ...body, actor_pubkey: a.pubkey, dry_run: true } });
  if (dry.status !== 200) return dry;
  const wire = dry.body.wire_event;
  return http('POST', `/batches/${batchId}/events`, {
    token: a.token,
    body: { ...body, actor_pubkey: a.pubkey, actor_sig: await signWire(wire, a.seed), created_at: wire.created_at, seq: wire.seq },
  });
}

async function advance(a: Actor, batchId: string, stage: string) {
  const r = await signedEvent(a, batchId, { event_type: 'STAGE_ADVANCE', to_stage: stage, payload: { note: `to ${stage}` } });
  expect(r.status, `${a.role} -> ${stage}: ${JSON.stringify(r.body)}`).toBe(201);
  expect(r.body.batch.current_stage).toBe(stage);
}

async function handover(from: Actor, to: Actor, batchId: string) {
  const start = await http('POST', `/batches/${batchId}/handover/start`, { token: from.token });
  expect(start.status, JSON.stringify(start.body)).toBe(201);
  const url = `/handover/${encodeURIComponent(start.body.token)}/accept`;
  const dry = await http('POST', url, { token: to.token, body: { actor_pubkey: to.pubkey, dry_run: true } });
  expect(dry.status, JSON.stringify(dry.body)).toBe(200);
  const wire = dry.body.wire_event;
  const ok = await http('POST', url, {
    token: to.token,
    body: { actor_pubkey: to.pubkey, actor_sig: await signWire(wire, to.seed), created_at: wire.created_at, seq: wire.seq },
  });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(ok.body.batch.current_holder_id).toBe(to.id);
  // One-time token: a second acceptance is refused.
  const again = await http('POST', url, { token: to.token, body: { actor_pubkey: to.pubkey, dry_run: true } });
  expect(again.status).toBe(410);
}

async function evidence(a: Actor, batchId: string, type: string, meta: Record<string, unknown> = {}) {
  const r = await http('POST', `/batches/${batchId}/evidence`, {
    token: a.token, body: { evidence_type: type, file_hash: sha(`${batchId}:${type}:${Math.random()}`), meta },
  });
  expect(r.status, `${a.role} adds ${type}: ${JSON.stringify(r.body)}`).toBe(201);
  return r.body;
}

async function verifiedChain(traceId: string) {
  const raw = await http('GET', `/verify/${traceId}`);
  expect(raw.status).toBe(200);
  const result = await verifyChainIndependent(raw.body.events as VerifyEvent[]);
  return { events: raw.body.events as VerifyEvent[], ...result };
}

// ── The flow ───────────────────────────────────────────────

describe('pilot flow on a real database', () => {
  let farmer: Actor, aggregator: Actor, processor: Actor, exporter: Actor, inspector: Actor, buyer: Actor;

  beforeAll(async () => {
    farmer = await signUp('farmer');
    aggregator = await signUp('aggregator');
    processor = await signUp('processor');
    exporter = await signUp('exporter');
    inspector = await signUp('inspector');
    buyer = await signUp('buyer');
  });

  it('applies every migration and seeds the corridors', async () => {
    const r = await http('GET', '/corridors');
    expect(r.status).toBe(200);
    const codes = (r.body.corridors as Array<{ code: string }>).map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['NG-EU-SESAME', 'NG-AE-SESAME']));
  });

  it('self-verified accounts act with no admin step', async () => {
    const me = await http('GET', '/entities/me', { token: exporter.token });
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).toContain('self_verified');
    const admin = await http('POST', '/auth/register', { body: { ...registration('buyer'), role: 'admin', email: `it-admin-${tag}@integration.test` } });
    expect(admin.status).toBe(403);
  });

  it('NG-AE-SESAME: harvest to DELIVERED with signed events, handovers and the buyer confirmation', async () => {
    const noBuyer = await http('POST', '/batches', {
      token: farmer.token,
      body: { commodity: 'sesame', quantity: 1000, unit: 'kg', production_date: '2026-11-01', corridor: 'NG-AE-SESAME' },
    });
    expect(noBuyer.body.code).toBe('BUYER_REQUIRED');

    const created = await http('POST', '/batches', {
      token: farmer.token,
      body: { commodity: 'sesame', quantity: 1000, unit: 'kg', production_date: '2026-11-01', origin_state: 'Jigawa', corridor: 'NG-AE-SESAME', buyer_nexus_id: buyer.nexus_id },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.batch.id as string;
    const traceId = created.body.batch.trace_id as string;

    // F4: only the next stage; custody moves only by handover.
    const skip = await signedEvent(farmer, id, { event_type: 'STAGE_ADVANCE', to_stage: 'PACKED', payload: {} });
    expect(skip.body.code).toBe('STAGE_ORDER');
    const forged = await http('POST', `/batches/${id}/events`, { token: farmer.token, body: { event_type: 'CUSTODY_TRANSFER', payload: { to_entity_id: aggregator.id } } });
    expect(forged.body.code).toBe('SERVER_ONLY_EVENT');

    await handover(farmer, aggregator, id);
    // A signature over different bytes is rejected before anything is stored.
    const dry = await http('POST', `/batches/${id}/events`, { token: aggregator.token, body: { event_type: 'STAGE_ADVANCE', to_stage: 'AGGREGATED', payload: {}, actor_pubkey: aggregator.pubkey, dry_run: true } });
    const bad = await http('POST', `/batches/${id}/events`, {
      token: aggregator.token,
      body: { event_type: 'STAGE_ADVANCE', to_stage: 'AGGREGATED', payload: {}, actor_pubkey: aggregator.pubkey,
        actor_sig: await signWire({ ...dry.body.wire_event, payload: { forged: true } }, aggregator.seed),
        created_at: dry.body.wire_event.created_at, seq: dry.body.wire_event.seq },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('BAD_SIGNATURE');
    // The farmer no longer holds it.
    const notHolder = await signedEvent(farmer, id, { event_type: 'STAGE_ADVANCE', to_stage: 'AGGREGATED', payload: {} });
    expect(notHolder.status).toBe(403);

    await advance(aggregator, id, 'AGGREGATED');
    await handover(aggregator, processor, id);
    await evidence(processor, id, 'PHOTO');
    await evidence(processor, id, 'PACKHOUSE_LOG');
    await advance(processor, id, 'PACKED');
    await handover(processor, exporter, id);
    await advance(exporter, id, 'IN_TRANSIT');
    await advance(exporter, id, 'AT_PORT');

    // A holder-uploaded phyto certificate does not satisfy the inspector-only gate.
    await evidence(exporter, id, 'PHYTOSANITARY_CERT');
    await evidence(exporter, id, 'EXPORT_DECLARATION');
    await evidence(exporter, id, 'CERTIFICATE_OF_ORIGIN');
    const early = await signedEvent(exporter, id, { event_type: 'STAGE_ADVANCE', to_stage: 'EXPORTED', payload: {} });
    expect(early.status).toBe(422);
    expect(early.body.gate.invalid_issuer).toEqual(['PHYTOSANITARY_CERT']);
    expect(early.body.recorded).toBe(false); // a dry-run never writes

    // An unassigned inspector cannot add reports; once assigned it can.
    const unassigned = await http('POST', `/batches/${id}/evidence`, { token: inspector.token, body: { evidence_type: 'PHYTOSANITARY_CERT', file_hash: sha('x') } });
    expect(unassigned.status).toBe(403);
    expect((await http('POST', `/batches/${id}/assignments`, { token: exporter.token, body: { nexus_id: inspector.nexus_id } })).status).toBe(201);
    await evidence(inspector, id, 'PHYTOSANITARY_CERT');
    const signoff = await signedEvent(inspector, id, { event_type: 'INSPECTION_SIGNOFF', payload: { decision: 'approved' } });
    expect(signoff.status, JSON.stringify(signoff.body)).toBe(201);
    await advance(exporter, id, 'EXPORTED');

    await handover(exporter, buyer, id);
    // UAE: DELIVERED needs the named buyer's DELIVERY_CONFIRMED first.
    const tooSoon = await signedEvent(buyer, id, { event_type: 'STAGE_ADVANCE', to_stage: 'DELIVERED', payload: {} });
    expect(tooSoon.status).toBe(422);
    expect(tooSoon.body.gate.missing_events).toEqual(['DELIVERY_CONFIRMED']);
    const confirm = await signedEvent(buyer, id, { event_type: 'DELIVERY_CONFIRMED', payload: { note: 'received' } });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(201);
    await advance(buyer, id, 'DELIVERED');

    // The public trace: no login, every stage reached, chain valid on the server and independently.
    const trace = await http('GET', `/trace/${traceId}`);
    expect(trace.status).toBe(200);
    expect(trace.body.batch.current_stage).toBe('DELIVERED');
    expect(trace.body.corridor.code).toBe('NG-AE-SESAME');
    expect(trace.body.server_integrity).toEqual({ valid: true, problems: [] });
    expect(trace.body.route.every((s: { reached: boolean }) => s.reached)).toBe(true);
    expect(trace.body.custody.map((c: { to_role: string }) => c.to_role)).toEqual(['farmer', 'aggregator', 'processor', 'exporter', 'buyer']);
    const exported = trace.body.route.find((s: { stage: string }) => s.stage === 'EXPORTED');
    const phyto = exported.gate.items.find((i: { type: string }) => i.type === 'PHYTOSANITARY_CERT');
    expect(phyto.satisfied_by.issuer_role).toBe('inspector');
    expect(JSON.stringify(trace.body)).not.toContain(farmer.id); // no entity ids in the public view

    const chain = await verifiedChain(traceId);
    expect(chain.problems).toEqual([]);
    expect(chain.valid).toBe(true);
    const signedTypes = chain.events.filter((e) => e.actor_sig).map((e) => e.event_type);
    expect(signedTypes).toEqual(expect.arrayContaining(['CUSTODY_TRANSFER', 'STAGE_ADVANCE', 'INSPECTION_SIGNOFF', 'DELIVERY_CONFIRMED']));
  });

  it('NG-EU-SESAME: PACKED is blocked without a lab report, and the trace says who must supply it', async () => {
    const created = await http('POST', '/batches', {
      token: farmer.token,
      body: { commodity: 'sesame', quantity: 500, unit: 'kg', production_date: '2026-11-01', corridor: 'NG-EU-SESAME' },
    });
    expect(created.status).toBe(201);
    const id = created.body.batch.id as string;
    const traceId = created.body.batch.trace_id as string;
    await handover(farmer, aggregator, id);
    await advance(aggregator, id, 'AGGREGATED');
    await handover(aggregator, processor, id);
    await evidence(processor, id, 'PHOTO');
    await evidence(processor, id, 'PACKHOUSE_LOG');
    // A lab report uploaded by the holder is the wrong issuer.
    await evidence(processor, id, 'LAB_REPORT', { analytes: ['MRL', 'AFLATOXIN', 'ETHYLENE_OXIDE'] });

    const dry = await signedEvent(processor, id, { event_type: 'STAGE_ADVANCE', to_stage: 'PACKED', payload: {} });
    expect(dry.status).toBe(422);
    expect(dry.body.code).toBe('GATE_FAILED');
    expect(dry.body.recorded).toBe(false);
    const item = dry.body.gate.checklist.find((i: { type: string }) => i.type === 'LAB_REPORT');
    expect(item).toMatchObject({ satisfied: false, supplied_by: ['lab'], analytes: ['MRL', 'AFLATOXIN', 'ETHYLENE_OXIDE'] });

    // A submitted attempt is recorded on the chain as GATE_REJECTED, and the batch does not move.
    const attempt = await http('POST', `/batches/${id}/events`, {
      token: processor.token, body: { event_type: 'STAGE_ADVANCE', to_stage: 'PACKED', payload: {}, actor_pubkey: processor.pubkey },
    });
    expect(attempt.status).toBe(422);
    expect(attempt.body.recorded).toBe(true);

    const trace = await http('GET', `/trace/${traceId}`);
    expect(trace.body.batch.current_stage).toBe('AGGREGATED');
    const packed = trace.body.route.find((s: { stage: string }) => s.stage === 'PACKED');
    expect(packed.reached).toBe(false);
    expect(packed.gate.passed).toBe(false);
    expect(packed.gate.items.find((i: { type: string }) => i.type === 'LAB_REPORT')).toMatchObject({ satisfied: false, supplied_by: ['lab'] });
    expect(trace.body.history.some((h: { event_type: string }) => h.event_type === 'GATE_REJECTED')).toBe(true);
    expect((await verifiedChain(traceId)).valid).toBe(true);
  });
});

// ── The demo seed script, against the real app over HTTP ──

describe('scripts/seed-demo.ts', () => {
  let base: string;
  let dir: string;

  beforeAll(async () => {
    const { buildApp } = await import('../../src/app.js');
    const server = await buildApp();
    base = await server.listen({ port: 0, host: '127.0.0.1' });
    dir = mkdtempSync(join(tmpdir(), 'atims-seed-'));
    return async () => {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    };
  });

  it('creates the three demo traces, and a rerun reuses them', async () => {
    const { seedDemo } = await import('../../../scripts/seed-demo.js');
    const out = join(dir, 'creds.json');
    const lines: string[] = [];
    const noPrompt = async () => { throw new Error('dev_code expected: the test API has no email provider'); };
    const first = await seedDemo({ api: base, out, log: (l) => lines.push(l), promptCode: noPrompt });

    expect(first.batches.eu.stage).toBe('DELIVERED');
    expect(first.batches.uae.stage).toBe('DELIVERED');
    expect(first.batches.blocked.stage).toBe('AGGREGATED');
    for (const b of Object.values(first.batches)) expect(b.chain_valid).toBe(true);
    expect(first.batches.eu.url).toBe(`http://localhost:5173/trace/${first.batches.eu.trace_id}`);

    const eu = await http('GET', `/trace/${first.batches.eu.trace_id}`);
    expect(eu.body.corridor.code).toBe('NG-EU-SESAME');
    const packed = eu.body.route.find((s: { stage: string }) => s.stage === 'PACKED');
    expect(packed.gate.items.find((i: { type: string }) => i.type === 'LAB_REPORT').satisfied_by.issuer_role).toBe('lab');
    const uae = await http('GET', `/trace/${first.batches.uae.trace_id}`);
    expect(uae.body.history.some((h: { event_type: string; actor_role: string }) => h.event_type === 'DELIVERY_CONFIRMED' && h.actor_role === 'buyer')).toBe(true);
    const blocked = await http('GET', `/trace/${first.batches.blocked.trace_id}`);
    expect(blocked.body.route.find((s: { stage: string }) => s.stage === 'PACKED').gate.items
      .find((i: { type: string }) => i.type === 'LAB_REPORT')).toMatchObject({ satisfied: false, supplied_by: ['lab'] });

    // Every role has a DEMO account, and the credentials file holds the passwords.
    const creds = JSON.parse(readFileSync(out, 'utf8'));
    const accounts = creds[base].accounts as Record<string, { name: string; email: string; password: string; role: string }>;
    expect(new Set(Object.values(accounts).map((x) => x.role))).toEqual(
      new Set(['farmer', 'aggregator', 'processor', 'exporter', 'lab', 'inspector', 'buyer', 'regulator']));
    for (const x of Object.values(accounts)) {
      expect(x.name.startsWith('DEMO')).toBe(true);
      expect(x.email.endsWith('@demo.sprezzint.com')).toBe(true);
      expect(x.password.length).toBeGreaterThanOrEqual(10);
    }

    const before = (await verifiedChain(first.batches.eu.trace_id)).events.length;
    const second = await seedDemo({ api: base, out, log: () => {}, promptCode: noPrompt });
    expect(second.batches.eu.trace_id).toBe(first.batches.eu.trace_id);
    expect(second.batches.uae.trace_id).toBe(first.batches.uae.trace_id);
    expect(second.batches.blocked.trace_id).toBe(first.batches.blocked.trace_id);
    expect((await verifiedChain(first.batches.eu.trace_id)).events.length).toBe(before); // nothing redone
  });
});

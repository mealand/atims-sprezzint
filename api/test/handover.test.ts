/**
 * F3/F11: accepting a handover is one transaction that locks the token and the
 * batch, only custody roles may accept, and the CUSTODY_TRANSFER is signed with
 * the same rules (and 10-minute created_at window) as every other client event.
 * Runs against a fake connection that records every statement.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as ed from '@noble/ed25519';
import { canonicalize } from '@atims/shared';
import type { AccessEntity, BatchParties } from '../src/services/access.js';
import type { Queryable } from '../src/services/tx.js';

process.env.JWT_SECRET ??= 'test-secret-at-least-16-chars';
process.env.NODE_ENV ??= 'test';

let acceptHandover: typeof import('../src/services/handover.js')['acceptHandover'];
let extractHandoverToken: typeof import('../src/services/handover.js')['extractHandoverToken'];
beforeAll(async () => {
  ({ acceptHandover, extractHandoverToken } = await import('../src/services/handover.js'));
});

const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const HOLDER = 'holder-farmer';
const BATCH = 'batch-1';

interface State {
  token: Record<string, unknown> | null;
  batch: Record<string, unknown> | null;
  maxSeq: number;
}

function fakeClient(state: State): Queryable & { log: string[] } {
  const log: string[] = [];
  const client = {
    log,
    // Generic like Queryable.query; rows are cast because this fake returns untyped records.
    async query<T>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
      return { rows: respond(text, params) as T[] };
    },
  };
  function respond(text: string, params: unknown[]): Record<string, unknown>[] {
    const sql = text.replace(/\s+/g, ' ').trim();
    log.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return [];
    if (sql.startsWith('SELECT * FROM handover_tokens')) return state.token && state.token.token === params[0] ? [state.token] : [];
    if (sql.startsWith('SELECT * FROM batches')) return state.batch ? [state.batch] : [];
    if (sql.includes('COALESCE(MAX(seq)')) return [{ s: state.maxSeq + 1 }];
    if (sql.startsWith('SELECT seq, payload_hash')) {
      return [{ batch_id: BATCH, seq: state.maxSeq, payload_hash: 'a'.repeat(64), actor_pubkey: null, actor_sig: null }];
    }
    if (sql.startsWith('INSERT INTO batch_events')) return [{ id: 'ev-1', seq: params[1] }];
    if (sql.startsWith('UPDATE handover_tokens')) return [];
    if (sql.startsWith('UPDATE batches')) return [{ ...state.batch, current_holder_id: params[1] }];
    throw new Error(`unexpected SQL: ${sql}`);
  }
  return client;
}

function freshState(over: Partial<State> = {}): State {
  return {
    token: {
      id: 'tok-1', batch_id: BATCH, token: 'TOKEN', from_holder: HOLDER, used_at: null, used_by: null,
      expires_at: new Date(NOW + 30 * 60_000).toISOString(),
    },
    batch: { id: BATCH, origin_entity_id: HOLDER, current_holder_id: HOLDER, buyer_id: 'buyer-1', current_stage: 'HARVESTED' },
    maxSeq: 2,
    ...over,
  };
}

const parties = async (batchId: string): Promise<BatchParties> => ({
  id: batchId, origin_entity_id: HOLDER, current_holder_id: HOLDER, buyer_id: 'buyer-1',
  past_holder_ids: [HOLDER], contributor_ids: [HOLDER], assigned_ids: [],
});

const aggregator: AccessEntity = { id: 'agg-1', role: 'aggregator', status: 'verified', trust_tier: 'self_verified' };

async function key() {
  const priv = ed.utils.randomPrivateKey();
  return { priv, pub: Buffer.from(await ed.getPublicKeyAsync(priv)).toString('base64') };
}
const sign = async (wire: unknown, priv: Uint8Array) =>
  Buffer.from(await ed.signAsync(new TextEncoder().encode(canonicalize(wire)), priv)).toString('base64');

/** Dry-run then signed submit, as HandoverAccept.tsx does. */
async function acceptAs(me: AccessEntity, state: State, opts: { tamper?: boolean; createdAtShiftMs?: number } = {}) {
  const k = await key();
  const dryClient = fakeClient(state);
  const dry = await acceptHandover(dryClient, { token: 'TOKEN', me, body: { actor_pubkey: k.pub, dry_run: true }, loadParties: parties, now: NOW });
  if (dry.kind !== 'dry_run') return { dry, dryClient };
  const wire = opts.tamper ? { ...dry.wire_event, payload: { to_entity_id: 'someone-else' } } : dry.wire_event;
  const sig = await sign(wire, k.priv);
  const createdAt = opts.createdAtShiftMs
    ? new Date(Date.parse(dry.wire_event.created_at) - opts.createdAtShiftMs).toISOString()
    : dry.wire_event.created_at;
  const client = fakeClient(state);
  const out = await acceptHandover(client, {
    token: 'TOKEN', me, body: { actor_pubkey: k.pub, actor_sig: sig, created_at: createdAt, seq: dry.wire_event.seq },
    loadParties: parties, now: NOW,
  });
  return { dry, dryClient, out, client };
}

describe('handover accept transaction', () => {
  it('locks the token, then the batch, then appends, marks the token used and moves custody, in one transaction', async () => {
    const { out, client } = await acceptAs(aggregator, freshState());
    expect(out?.kind).toBe('accepted');
    const steps = client!.log.map((s) => s.split(' ').slice(0, 3).join(' '));
    expect(client!.log[0]).toBe('BEGIN');
    expect(client!.log[1]).toMatch(/FROM handover_tokens WHERE token = \$1 FOR UPDATE$/);
    expect(client!.log[2]).toMatch(/FROM batches WHERE id = \$1 FOR UPDATE$/);
    expect(steps).toContain('INSERT INTO batch_events');
    expect(steps).toContain('UPDATE handover_tokens SET');
    expect(steps).toContain('UPDATE batches SET');
    expect(client!.log.at(-1)).toBe('COMMIT');
    expect(client!.log).not.toContain('ROLLBACK');
    if (out?.kind === 'accepted') expect(out.batch.current_holder_id).toBe('agg-1');
  });

  it('dry-run returns the CUSTODY_TRANSFER wire event and writes nothing', async () => {
    const state = freshState();
    const k = await key();
    const client = fakeClient(state);
    const dry = await acceptHandover(client, { token: 'TOKEN', me: aggregator, body: { actor_pubkey: k.pub, dry_run: true }, loadParties: parties, now: NOW });
    expect(dry.kind).toBe('dry_run');
    if (dry.kind === 'dry_run') {
      expect(dry.wire_event).toMatchObject({ event_type: 'CUSTODY_TRANSFER', seq: 3, actor_id: 'agg-1', to_stage: null, actor_pubkey: k.pub });
      expect(dry.wire_event.payload).toEqual({ to_entity_id: 'agg-1', via: 'handover', token_id: 'tok-1' });
    }
    expect(client.log.some((s) => /^(INSERT|UPDATE)/.test(s))).toBe(false);
    expect(client.log.at(-1)).toBe('ROLLBACK');
  });

  it.each(['lab', 'inspector', 'regulator', 'admin'] as const)('a %s cannot take custody', async (role) => {
    const client = fakeClient(freshState());
    const k = await key();
    const out = await acceptHandover(client, { token: 'TOKEN', me: { id: `${role}-1`, role, status: 'verified', trust_tier: 'kyb_verified' }, body: { actor_pubkey: k.pub, dry_run: true }, loadParties: parties, now: NOW });
    expect(out).toMatchObject({ kind: 'rejected', status: 403 });
    expect(client.log.at(-1)).toBe('ROLLBACK');
  });

  it.each(['farmer', 'aggregator', 'processor', 'exporter'] as const)('a %s can take custody', async (role) => {
    const { out } = await acceptAs({ id: `${role}-9`, role, status: 'verified', trust_tier: 'self_verified' }, freshState());
    expect(out?.kind).toBe('accepted');
  });

  it('a buyer can take custody only of a batch named for it', async () => {
    const named = await acceptAs({ id: 'buyer-1', role: 'buyer', status: 'verified', trust_tier: 'self_verified' }, freshState());
    expect(named.out?.kind).toBe('accepted');
    const other = await acceptAs({ id: 'buyer-2', role: 'buyer', status: 'verified', trust_tier: 'self_verified' }, freshState());
    expect(other.dry).toMatchObject({ kind: 'rejected', status: 403 });
  });

  it('an unverified account cannot accept', async () => {
    const r = await acceptAs({ ...aggregator, trust_tier: 'registered' }, freshState());
    expect(r.dry).toMatchObject({ kind: 'rejected', status: 403 });
  });

  it('created_at must be inside the same 10-minute window as signed events', async () => {
    const { out, client } = await acceptAs(aggregator, freshState(), { createdAtShiftMs: 11 * 60_000 });
    expect(out).toMatchObject({ kind: 'rejected', status: 409, code: 'STALE_EVENT' });
    expect(client!.log.some((s) => s.startsWith('INSERT'))).toBe(false);
  });

  it('a final submission without created_at is refused', async () => {
    const k = await key();
    const out = await acceptHandover(fakeClient(freshState()), { token: 'TOKEN', me: aggregator, body: { actor_pubkey: k.pub, actor_sig: 'x' }, loadParties: parties, now: NOW });
    expect(out).toMatchObject({ kind: 'rejected', code: 'CREATED_AT_REQUIRED' });
  });

  it('a bad signature writes nothing', async () => {
    const { out, client } = await acceptAs(aggregator, freshState(), { tamper: true });
    expect(out).toMatchObject({ kind: 'rejected', code: 'BAD_SIGNATURE' });
    expect(client!.log.some((s) => /^(INSERT|UPDATE)/.test(s))).toBe(false);
    expect(client!.log.at(-1)).toBe('ROLLBACK');
  });

  it('an unsigned accept is refused before the transaction starts', async () => {
    const client = fakeClient(freshState());
    const out = await acceptHandover(client, { token: 'TOKEN', me: aggregator, body: {}, loadParties: parties, now: NOW });
    expect(out).toMatchObject({ kind: 'rejected', code: 'PUBKEY_REQUIRED' });
    expect(client.log).toEqual([]);
  });

  it('refuses used, expired, unknown and own tokens', async () => {
    const k = await key();
    const run = (state: State, me: AccessEntity = aggregator, token = 'TOKEN') =>
      acceptHandover(fakeClient(state), { token, me, body: { actor_pubkey: k.pub, dry_run: true }, loadParties: parties, now: NOW });
    const base = freshState();
    expect(await run({ ...base, token: { ...base.token!, used_at: new Date(NOW).toISOString() } })).toMatchObject({ status: 410, code: 'TOKEN_USED' });
    expect(await run({ ...base, token: { ...base.token!, expires_at: new Date(NOW - 1).toISOString() } })).toMatchObject({ status: 410, code: 'TOKEN_EXPIRED' });
    expect(await run(base, aggregator, 'WRONG')).toMatchObject({ status: 404 });
    expect(await run(base, { id: HOLDER, role: 'farmer', status: 'verified' })).toMatchObject({ status: 409, code: 'OWN_HANDOVER' });
  });

  it('refuses when custody moved after the token was minted', async () => {
    const base = freshState();
    const r = await acceptAs(aggregator, { ...base, batch: { ...base.batch!, current_holder_id: 'someone-else' } });
    expect(r.dry).toMatchObject({ kind: 'rejected', status: 409, code: 'CUSTODY_MOVED' });
  });
});

describe('handover QR parsing', () => {
  it('takes the token from the full accept URL, a relative link, the legacy scheme or a bare token', () => {
    expect(extractHandoverToken('https://atims.sprezzint.com/handover/accept?token=abc-DEF_1')).toBe('abc-DEF_1');
    expect(extractHandoverToken('/handover/accept?token=abc%2Bx&x=1')).toBe('abc+x');
    expect(extractHandoverToken('atims://handover/abc123')).toBe('abc123');
    expect(extractHandoverToken('  abc123  ')).toBe('abc123');
  });
});

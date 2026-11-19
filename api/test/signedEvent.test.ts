/**
 * F1 regression tests: the two-phase sign flow exactly as the frontend runs it
 * (dry-run wire event -> noble ed25519 sign -> final submission), checked with
 * the same helpers the route uses, and against the full chain verifier.
 */
import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { canonicalize, canonicalHash } from '@atims/shared';
import {
  buildWireEvent, checkPubkey, checkSignedSubmission, resolveSignedCreatedAt, CREATED_AT_WINDOW_MS,
  type WireInput,
} from '../src/services/signedEvent.js';
import { verifyChain, prevHashOf, type EventRow } from '../src/services/chain.js';

async function deviceKey() {
  const priv = ed.utils.randomPrivateKey();
  const pub = Buffer.from(await ed.getPublicKeyAsync(priv)).toString('base64');
  return { priv, pub };
}
/** Same bytes the browser signs in frontend/src/lib/keys.ts signCanonical(). */
async function sign(wire: unknown, priv: Uint8Array) {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(canonicalize(wire)), priv)).toString('base64');
}

const base = (pub: string, over: Partial<WireInput> = {}): WireInput => ({
  batchId: 'batch-1', seq: 1, eventType: 'STAGE_ADVANCE', actorId: 'actor-1', actorPubkey: pub,
  toStage: 'AGGREGATED', payload: { note: 'received at hub' }, createdAt: new Date().toISOString(), ...over,
});

describe('F1: client-signed events', () => {
  it('fixed flow: dry-run with pubkey, sign, final with echoed created_at + seq verifies', async () => {
    const { priv, pub } = await deviceKey();
    // dry-run (server computes created_at)
    const dry = buildWireEvent(base(pub));
    const sig = await sign(dry, priv);
    // final: server rebuilds from the echoed fields
    const ts = resolveSignedCreatedAt(dry.created_at);
    expect('value' in ts).toBe(true);
    const finalWire = buildWireEvent(base(pub, { createdAt: (ts as { value: string }).value }));
    expect(canonicalize(finalWire)).toBe(canonicalize(dry));
    expect(checkSignedSubmission({ wire: finalWire, actorSig: sig, clientSeq: dry.seq })).toBeNull();
  });

  it('old broken flow (dry-run without pubkey) is now rejected before storage', async () => {
    const { priv, pub } = await deviceKey();
    const dryWithoutKey = { ...buildWireEvent(base(pub)), actor_pubkey: null };
    const sig = await sign(dryWithoutKey, priv);
    const finalWire = buildWireEvent(base(pub, { createdAt: dryWithoutKey.created_at }));
    expect(checkSignedSubmission({ wire: finalWire, actorSig: sig, clientSeq: 1 })?.code).toBe('BAD_SIGNATURE');
  });

  it('old offline flow (created_at replaced by queued_at) is rejected', async () => {
    const { priv, pub } = await deviceKey();
    const dry = buildWireEvent(base(pub));
    const sig = await sign(dry, priv);
    const queuedAt = new Date(Date.now() - 60_000).toISOString();
    const finalWire = buildWireEvent(base(pub, { createdAt: queuedAt }));
    expect(checkSignedSubmission({ wire: finalWire, actorSig: sig, clientSeq: dry.seq })?.code).toBe('BAD_SIGNATURE');
  });

  it('chain moved between dry-run and submit -> 409 STALE_EVENT so the client re-signs', async () => {
    const { priv, pub } = await deviceKey();
    const dry = buildWireEvent(base(pub, { seq: 1 }));
    const sig = await sign(dry, priv);
    const now = buildWireEvent(base(pub, { seq: 2, createdAt: dry.created_at }));
    const r = checkSignedSubmission({ wire: now, actorSig: sig, clientSeq: 1 });
    expect(r).toMatchObject({ status: 409, code: 'STALE_EVENT' });
  });

  it('tampered payload, wrong key, or missing signature are rejected', async () => {
    const a = await deviceKey();
    const b = await deviceKey();
    const dry = buildWireEvent(base(a.pub));
    const sig = await sign(dry, a.priv);
    const tampered = buildWireEvent(base(a.pub, { createdAt: dry.created_at, payload: { note: 'edited' } }));
    expect(checkSignedSubmission({ wire: tampered, actorSig: sig, clientSeq: 1 })?.code).toBe('BAD_SIGNATURE');
    const otherKey = buildWireEvent(base(b.pub, { createdAt: dry.created_at }));
    expect(checkSignedSubmission({ wire: otherKey, actorSig: sig, clientSeq: 1 })?.code).toBe('BAD_SIGNATURE');
    expect(checkSignedSubmission({ wire: dry, actorSig: undefined, clientSeq: 1 })?.code).toBe('SIGNATURE_REQUIRED');
  });

  it('public key must be a raw 32-byte base64 key', async () => {
    const { pub } = await deviceKey();
    expect(checkPubkey(pub)).toBeNull();
    expect(checkPubkey(undefined)?.code).toBe('PUBKEY_REQUIRED');
    expect(checkPubkey('not-a-key')?.code).toBe('BAD_PUBKEY');
    expect(checkPubkey('-----BEGIN PUBLIC KEY-----')?.code).toBe('BAD_PUBKEY');
  });

  it('created_at is required, validated and never silently replaced', () => {
    expect(resolveSignedCreatedAt(undefined)).toMatchObject({ code: 'CREATED_AT_REQUIRED' });
    expect(resolveSignedCreatedAt('yesterday-ish')).toMatchObject({ code: 'BAD_CREATED_AT' });
    const old = new Date(Date.now() - CREATED_AT_WINDOW_MS - 1000).toISOString();
    expect(resolveSignedCreatedAt(old)).toMatchObject({ status: 409, code: 'STALE_EVENT' });
    const iso = new Date().toISOString();
    expect(resolveSignedCreatedAt(iso)).toEqual({ value: iso });
  });

  it('a chain of genesis + two client-signed events verifies with no problems', async () => {
    const { priv, pub } = await deviceKey();
    const created = '2026-11-20T10:00:00.000Z';
    const genesisWire = {
      batch_id: 'batch-1', seq: 0, event_type: 'BATCH_CREATED', actor_id: 'actor-1', actor_pubkey: null,
      to_stage: 'HARVESTED', payload: { created: { commodity: 'ginger' } }, created_at: created,
    };
    const rows: EventRow[] = [{
      ...genesisWire, to_stage: 'HARVESTED', actor_sig: null, prev_hash: null, payload_hash: canonicalHash(genesisWire),
    } as EventRow];
    for (const [seq, stage] of [[1, 'AGGREGATED'], [2, 'PACKED']] as const) {
      const wire = buildWireEvent(base(pub, { seq, toStage: stage, createdAt: created }));
      const sig = await sign(wire, priv);
      expect(checkSignedSubmission({ wire, actorSig: sig, clientSeq: seq })).toBeNull();
      rows.push({
        ...wire, to_stage: stage, actor_sig: sig, prev_hash: prevHashOf(rows[rows.length - 1]),
        payload_hash: canonicalHash(wire),
      } as EventRow);
    }
    const result = verifyChain(rows);
    expect(result.problems).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(['seq 0: unsigned event (server-attested)']);
  });
});

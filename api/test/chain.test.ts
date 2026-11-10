import { describe, it, expect } from 'vitest';
import { payloadHashOf, eventPayloadFor, verifySig, prevHashOf } from '../src/services/chain.js';
import { canonicalize, canonicalHash, sha256Hex } from '@atims/shared';

const actorId = '11111111-1111-1111-1111-111111111111';
const pubkey = '-----BEGIN PUBLIC KEY-----TEST-----END PUBLIC KEY-----';

const base = {
  batch_id: 'b1', seq: 0, event_type: 'BATCH_CREATED',
  actor_id: actorId, actor_pubkey: null, to_stage: 'HARVESTED' as const,
  payload: { commodity: 'Tomato', quantity: 500 }, created_at: '2026-01-01T00:00:00.000Z',
};

describe('payload hashing', () => {
  it('payload_hash is canonical sha256 of the wire event', () => {
    const payload = eventPayloadFor(base);
    expect(payloadHashOf(payload)).toBe(canonicalHash(payload));
  });

  it('canonicalize + sha256Hex equals canonicalHash', () => {
    expect(sha256Hex(canonicalize(base))).toBe(canonicalHash(base));
  });
});

describe('prev_hash format', () => {
  it('deterministic and sensitive to expectations', () => {
    const a = prevHashOf({ batch_id: 'b1', seq: 1, payload_hash: 'h', actor_pubkey: null, actor_sig: null });
    expect(a).toHaveLength(64);
    expect(prevHashOf({ batch_id: 'b1', seq: 1, payload_hash: 'h', actor_pubkey: null, actor_sig: null })).toBe(a);
    expect(prevHashOf({ batch_id: 'b1', seq: 2, payload_hash: 'h', actor_pubkey: null, actor_sig: null })).not.toBe(a);
  });
});

describe('verifySig', () => {
  it('rejects null key/sig', () => {
    expect(verifySig({}, null, null)).toBe(false);
  });
  it('rejects garbage gracefully', () => {
    expect(verifySig({}, 'nonsense-key', 'nonsense-sig')).toBe(false);
  });
});

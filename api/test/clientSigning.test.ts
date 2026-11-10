/** Test: browser-style ed25519 (noble, same lib as the frontend) verifies server-side. */
import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { canonicalize } from '@atims/shared';
import { eventPayloadFor, payloadHashOf, verifySig, prevHashOf } from '../src/services/chain.js';
import { createHash } from 'node:crypto';

describe('client↔server signing interop (noble ed25519, raw-key wire format)', () => {
  it('server verifies a noble-signed canonical payload with a raw-base64 key', async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const pubkeyRaw = Buffer.from(pub).toString('base64');

    const wire = eventPayloadFor({
      batch_id: 'b-interop', seq: 0, event_type: 'CUSTODY_TRANSFER',
      actor_id: 'actor', actor_pubkey: pubkeyRaw, to_stage: 'AGGREGATED',
      payload: { to_entity_id: 'e-2' }, created_at: '2026-01-01T00:00:00.000Z',
    });

    const msg = new TextEncoder().encode(canonicalize(wire));
    const sig = Buffer.from(await ed.signAsync(msg, priv)).toString('base64');

    expect(verifySig(wire, pubkeyRaw, sig)).toBe(true);
    // tamper → false
    const tampered = { ...wire, payload: { to_entity_id: 'e-3' } };
    expect(verifySig(tampered, pubkeyRaw, sig)).toBe(false);
  });

  it('dry-run wire event hashes match what verifyChain expects', () => {
    const wire = eventPayloadFor({
      batch_id: 'b', seq: 1, event_type: 'NOTE', actor_id: 'a', actor_pubkey: null,
      to_stage: null, payload: { text: 'hi' }, created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(payloadHashOf(wire)).toHaveLength(64);
    const lnk = { batch_id: 'b', seq: 1, payload_hash: payloadHashOf(wire), actor_pubkey: null, actor_sig: 's' };
    expect(prevHashOf(lnk)).toBe(createHash('sha256').update(canonicalize(lnk)).digest('hex'));
  });
});

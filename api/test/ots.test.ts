import { describe, it, expect } from 'vitest';
import { findBitcoinHeight, hexToBytes, BTC_ATTESTATION_MARKER } from '../src/services/ots.js';

describe('OpenTimestamps proof parsing', () => {
  it('rejects invalid head digests', () => {
    expect(() => hexToBytes('nothex')).toThrow();
    expect(hexToBytes('a'.repeat(64)).length).toBe(32);
  });

  it('finds a Bitcoin attestation height in a raw .ots proof', () => {
    // minimal proof: padding + marker (05 88 96 0d 73) + LE block height 870000 + trailing bytes
    const ots = new Uint8Array([0x00, 0x00, ...BTC_ATTESTATION_MARKER, 0xf0, 0x45, 0x0d, 0x00, 0xff]);
    expect(findBitcoinHeight(ots)).toBe(0x000d45f0); // 870000
  });

  it('returns null for a pending (unconfirmed) proof', () => {
    const pending = new Uint8Array([0x83, 0xdf, 0x30, 0x01, 0x01, 0x88, 0x00]); // PendingAttestation-ish bytes
    expect(findBitcoinHeight(pending)).toBeNull();
  });

  it('guards against absurd heights', () => {
    const bad = new Uint8Array([...BTC_ATTESTATION_MARKER, 0xff, 0xff, 0xff, 0xff]);
    expect(findBitcoinHeight(bad)).toBeNull();
  });
});

/**
 * F10: OpenTimestamps proofs are parsed as the real tree format, the Bitcoin
 * attestation is 00 + 8-byte tag + varuint payload length + varuint height, and
 * upgrades ask each pending calendar for the commitment at that node (not for
 * the raw digest), then merge the answer into the proof.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  BTC_ATTESTATION_TAG, PENDING_ATTESTATION_TAG, bitcoinHeights, encodeVaruint, findBitcoinHeight, hexToBytes,
  isAllowedCalendar, mergeProofs, parseTimestamp, pendingAttestations, readVaruint, serializeTimestamp,
  toDetachedOtsFile, upgradeDigest,
} from '../src/services/ots.js';

const sha256 = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());
const HEAD = 'ab'.repeat(32);
const NONCE = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
const CAL = 'https://alice.btc.calendar.opentimestamps.org';

/** 00 + tag + varbytes(varuint(height)) */
const btcAttestation = (height: number) => {
  const payload = encodeVaruint(height);
  return [0x00, ...BTC_ATTESTATION_TAG, ...encodeVaruint(payload.length), ...payload];
};
const pendingAttestation = (uri: string) => {
  const u = [...new TextEncoder().encode(uri)];
  const payload = [...encodeVaruint(u.length), ...u];
  return [0x00, ...PENDING_ATTESTATION_TAG, ...encodeVaruint(payload.length), ...payload];
};
/** What a calendar answers on POST /digest: append nonce, sha256, pending attestation. */
const pendingProof = (uri = CAL) => Uint8Array.from([0xf0, NONCE.length, ...NONCE, 0x08, ...pendingAttestation(uri)]);

describe('varuint', () => {
  it('round-trips, including multi-byte values', () => {
    for (const n of [0, 1, 127, 128, 300, 870_000, 2 ** 32 + 5]) {
      expect(readVaruint(Uint8Array.from(encodeVaruint(n))).value).toBe(n);
    }
    expect(encodeVaruint(870_000)).toEqual([0xf0, 0x8c, 0x35]);
  });
});

describe('Bitcoin attestation parsing', () => {
  it('reads tag, varuint length, then varuint height', () => {
    // 870000 encodes as f0 8c 35 (3 bytes), so the payload length byte is 03.
    const proof = Uint8Array.from([0x08, ...btcAttestation(870_000)]);
    expect([...proof.slice(2, 10)]).toEqual([...BTC_ATTESTATION_TAG]);
    expect(proof[10]).toBe(3);
    expect(findBitcoinHeight(proof)).toBe(870_000);
  });

  it('does not read the length byte as part of a little-endian height (the old bug)', () => {
    const proof = Uint8Array.from(btcAttestation(500_000));
    expect(findBitcoinHeight(proof)).toBe(500_000);
  });

  it('needs all 8 tag bytes, not just the first 5', () => {
    const fake = Uint8Array.from([0x00, 0x05, 0x88, 0x96, 0x0d, 0x73, 0x00, 0x00, 0x00, 0x03, 0xf0, 0x8c, 0x35]);
    expect(findBitcoinHeight(fake)).toBeNull();
  });

  it('finds the earliest height among several attestations', () => {
    const proof = Uint8Array.from([0xff, ...btcAttestation(900_000), 0x08, ...btcAttestation(870_000)]);
    expect(findBitcoinHeight(proof)).toBe(870_000);
  });

  it('returns null for a pending proof', () => {
    expect(findBitcoinHeight(pendingProof())).toBeNull();
  });

  it('falls back to a strict scan for bytes that are not a whole proof', () => {
    const noisy = Uint8Array.from([0xde, 0xad, ...btcAttestation(870_000).slice(1), 0xbe]);
    expect(findBitcoinHeight(noisy)).toBe(870_000);
  });
});

describe('timestamp tree', () => {
  it('parses and re-serializes a calendar response byte for byte', () => {
    const bytes = pendingProof();
    const ts = parseTimestamp(bytes, hexToBytes(HEAD));
    expect(Buffer.from(serializeTimestamp(ts))).toEqual(Buffer.from(bytes));
  });

  it('computes the commitment of a pending attestation from the ops above it', () => {
    const ts = parseTimestamp(pendingProof(), hexToBytes(HEAD));
    const [p] = pendingAttestations(ts);
    expect(p.uri).toBe(CAL);
    expect(Buffer.from(p.commitment).toString('hex'))
      .toBe(Buffer.from(sha256(Uint8Array.from([...hexToBytes(HEAD), ...NONCE]))).toString('hex'));
  });

  it('rejects unknown op tags and trailing bytes', () => {
    expect(() => parseTimestamp(Uint8Array.from([0x99, 0x00]))).toThrow();
    expect(() => parseTimestamp(Uint8Array.from([...btcAttestation(1), 0x00]))).toThrow();
  });

  it('writes a detached .ots file that parses back to the same digest and heights', () => {
    const file = toDetachedOtsFile(HEAD, Uint8Array.from([0x08, ...btcAttestation(870_000)]));
    const ts = parseTimestamp(file);
    expect(Buffer.from(ts.msg!).toString('hex')).toBe(HEAD);
    expect(bitcoinHeights(ts)).toEqual([870_000]);
  });

  it('merging a resubmission keeps both calendar paths', () => {
    const a = Buffer.from(pendingProof(CAL)).toString('base64');
    const b = Buffer.from(pendingProof('https://bob.btc.calendar.opentimestamps.org')).toString('base64');
    const merged = parseTimestamp(Buffer.from(mergeProofs(HEAD, a, b), 'base64'), hexToBytes(HEAD));
    expect(pendingAttestations(merged).map((p) => p.uri).sort()).toEqual([CAL, 'https://bob.btc.calendar.opentimestamps.org']);
  });
});

describe('upgrade', () => {
  const commitment = () => sha256(Uint8Array.from([...hexToBytes(HEAD), ...NONCE]));

  it('asks the pending calendar for the commitment, merges the Bitcoin path and returns the height', async () => {
    const asked: string[] = [];
    const fetchFn = (async (url: string) => {
      asked.push(url);
      // calendar answer: from the commitment, sha256, then a Bitcoin attestation
      return new Response(Uint8Array.from([0x08, ...btcAttestation(870_000)]), { status: 200 });
    }) as unknown as typeof fetch;
    const up = await upgradeDigest(HEAD, Buffer.from(pendingProof()).toString('base64'), { fetchFn });
    expect(asked).toEqual([`${CAL}/timestamp/${Buffer.from(commitment()).toString('hex')}`]);
    expect(up?.height).toBe(870_000);
    // The stored proof is a complete path: digest -> nonce -> sha256 -> sha256 -> Bitcoin.
    const ts = parseTimestamp(Buffer.from(up!.proof, 'base64'), hexToBytes(HEAD));
    expect(bitcoinHeights(ts)).toEqual([870_000]);
    expect(pendingAttestations(ts)).toHaveLength(1); // the pending note is kept, as the reference client does
  });

  it('returns null while the calendar answers 404', async () => {
    const fetchFn = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    expect(await upgradeDigest(HEAD, Buffer.from(pendingProof()).toString('base64'), { fetchFn })).toBeNull();
  });

  it('never contacts a calendar URI outside the allowlist', async () => {
    let called = false;
    const fetchFn = (async () => { called = true; return new Response('', { status: 404 }); }) as unknown as typeof fetch;
    const evil = Buffer.from(pendingProof('https://169.254.169.254/latest')).toString('base64');
    expect(await upgradeDigest(HEAD, evil, { fetchFn })).toBeNull();
    expect(called).toBe(false);
  });

  it('a calendar that hangs or errors is skipped, not fatal', async () => {
    const fetchFn = (async () => { throw new Error('timeout'); }) as unknown as typeof fetch;
    expect(await upgradeDigest(HEAD, Buffer.from(pendingProof()).toString('base64'), { fetchFn })).toBeNull();
  });

  it('throws on an unreadable stored proof so the job can log and move on', async () => {
    await expect(upgradeDigest(HEAD, Buffer.from([0x99]).toString('base64'))).rejects.toThrow();
  });
});

describe('calendar allowlist', () => {
  it('accepts the public calendars over https only', () => {
    expect(isAllowedCalendar('https://alice.btc.calendar.opentimestamps.org')).toBe(true);
    expect(isAllowedCalendar('https://finney.calendar.eternitywall.com')).toBe(true);
    expect(isAllowedCalendar('https://btc.calendar.catallaxy.com')).toBe(true);
    expect(isAllowedCalendar('https://a.pool.opentimestamps.org')).toBe(true);
    expect(isAllowedCalendar('http://alice.btc.calendar.opentimestamps.org')).toBe(false);
    expect(isAllowedCalendar('https://evil.example/calendar.opentimestamps.org')).toBe(false);
    expect(isAllowedCalendar('https://localhost')).toBe(false);
  });

  it('rejects invalid head digests', () => {
    expect(() => hexToBytes('nothex')).toThrow();
    expect(hexToBytes('a'.repeat(64)).length).toBe(32);
  });
});

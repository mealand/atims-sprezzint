/**
 * OpenTimestamps anchoring (M5) — free, Bitcoin-anchored proof-of-existence.
 * No API keys; uses the public OTS calendar pool over plain HTTP(S).
 *
 * Protocol (verified against the live calendars, no external deps):
 *  - submit: POST {calendar}/digest with the 32-byte digest body → .ots bytes
 *    with *pending* attestations (HTTP 200).
 *  - upgrade: GET {calendar}/timestamp/{digest-hex} → 404 while unconfirmed
 *    (normal for hours after submit), 200 with the proof once a Bitcoin
 *    attestation is included. We detect confirmation via the
 *    BitcoinAttestation marker (05 88 96 0d 73) + 4-byte LE block height.
 *
 * Docs: https://opentimestamps.org — pools: a/b/c.pool.opentimestamps.org
 */

export const OTS_CALENDARS = (process.env.OTS_CALENDARS ??
  'https://a.pool.opentimestamps.org,https://b.pool.opentimestamps.org,https://a.pool.eternitywall.com,https://ots.btc.catallaxy.com')
  .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

const OTS_TIMEOUT_MS = 60_000; // public calendars are sometimes slow; be patient

/** Marker bytes that identify a Bitcoin block attestation inside an .ots file. */
export const BTC_ATTESTATION_MARKER = [0x05, 0x88, 0x96, 0x0d, 0x73];

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error('head digest must be 64 hex chars');
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

/** Parse a .ots proof: returns block height when a Bitcoin attestation is present. */
export function findBitcoinHeight(ots: Uint8Array): number | null {
  for (let i = 0; i + 9 <= ots.length; i++) {
    if (BTC_ATTESTATION_MARKER.every((b, j) => ots[i + j] === b)) {
      const height = ots[i + 5] | (ots[i + 6] << 8) | (ots[i + 7] << 16) | (ots[i + 8] << 24);
      if (height > 0 && height < 1e9) return height;
    }
  }
  return null;
}

/** Submit a head digest; returns base64 .ots (pending) or null when all calendars fail. */
export async function submitDigest(headHashHex: string): Promise<string | null> {
  const digest = hexToBytes(headHashHex);
  for (const cal of OTS_CALENDARS) {
    try {
      const res = await fetch(`${cal}/digest`, {
        method: 'POST', body: digest as unknown as BodyInit, signal: AbortSignal.timeout(OTS_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > 0) return Buffer.from(buf).toString('base64');
    } catch { /* try next calendar */ }
  }
  return null;
}

/**
 * Re-fetch the digest's .ots from the calendar.
 * 404 = still pending (normal; Bitcoin confirmation takes hours) → null.
 * Returns { proof, height } once the proof carries a Bitcoin attestation.
 */
export async function upgradeDigest(headHashHex: string, currentProofB64: string): Promise<{ proof: string; height: number | null } | null> {
  for (const cal of OTS_CALENDARS) {
    try {
      const res = await fetch(`${cal}/timestamp/${headHashHex}`, { signal: AbortSignal.timeout(OTS_TIMEOUT_MS) });
      if (res.status === 404) continue; // pending — ask again next tick
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === 0) continue;
      const proof = Buffer.from(buf).toString('base64');
      const height = findBitcoinHeight(buf);
      if (height !== null && proof !== currentProofB64) return { proof, height };
    } catch { /* try next calendar */ }
  }
  return null;
}

/**
 * Device-held ed25519 keys (M2.5).
 * Private key is generated in the browser and NEVER leaves the device.
 * Only the raw 32-byte public key (base64) is sent to the server, which
 * reconstructs SPKI and verifies signatures.
 * Backup = the 64-hex seed phrase shown in Settings (export/import).
 */
import * as ed from '@noble/ed25519';

const SEED_KEY = 'atims_ed25519_seed';

function toHex(b: Uint8Array) { return [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function fromHex(h: string) { return new Uint8Array((h.match(/.{2}/g) ?? []).map((x) => parseInt(x, 16))); }
function b64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }

export interface HeldKey { seed: string; pubkeyB64: string }

async function derive(seed: string): Promise<HeldKey> {
  const priv = fromHex(seed);
  const pub = await ed.getPublicKeyAsync(priv);
  return { seed, pubkeyB64: b64(pub) };
}

/** Get (creating on first use) this device's signing key. */
export async function ensureKey(): Promise<HeldKey> {
  const existing = localStorage.getItem(SEED_KEY);
  if (existing) return derive(existing);
  const seed = toHex(ed.utils.randomPrivateKey());
  localStorage.setItem(SEED_KEY, seed);
  return derive(seed);
}

/** Sign the canonical JSON (exact bytes the server persists). */
export async function signCanonical(payload: unknown, seed?: string): Promise<string> {
  const s = seed ?? localStorage.getItem(SEED_KEY);
  if (!s) throw new Error('no signing key on this device');
  const { canonicalize } = await import('@atims/shared');
  const msg = new TextEncoder().encode(canonicalize(payload));
  return b64(await ed.signAsync(msg, fromHex(s)));
}

/** Export backup phrase (64 hex chars). */
export function backupPhrase(): string {
  return localStorage.getItem(SEED_KEY) ?? '';
}

/** Import a backup phrase (validated by re-deriving the public key). */
export async function importPhrase(hex: string): Promise<boolean> {
  try {
    if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
    await derive(hex.toLowerCase());
    localStorage.setItem(SEED_KEY, hex.toLowerCase());
    return true;
  } catch {
    return false;
  }
}

/**
 * Independent chain verification — browser-safe (WebCrypto + @noble/ed25519).
 * Recomputes every payload hash, prev_hash link and signature from the raw
 * events, trusting NO server output. Used by both the /verify web page and
 * the atims-verify CLI so there is exactly one third-party verifier.
 *
 * Wire formats are frozen protocol: MUST stay in sync with api/src/services/chain.ts.
 */
import { canonicalize } from './canonical.js';

export interface VerifyEvent {
  batch_id: string;
  seq: number;
  event_type: string;
  actor_id: string;
  actor_pubkey: string | null;
  actor_sig: string | null;
  prev_hash: string | null;
  payload_hash: string;
  to_stage: string | null;
  payload: unknown;
  created_at: string; // ISO string (already normalized client-side of pg)
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The exact bytes hashed as `prev_hash` of the next event (frozen format). */
async function prevHashOf(link: Pick<VerifyEvent, 'batch_id' | 'seq' | 'payload_hash' | 'actor_pubkey' | 'actor_sig'>) {
  return sha256Hex(canonicalize({
    batch_id: link.batch_id,
    seq: link.seq,
    payload_hash: link.payload_hash,
    actor_pubkey: link.actor_pubkey ?? null,
    actor_sig: link.actor_sig ?? null,
  }));
}

/** ed25519 verify over canonicalize(eventPayload); raw 32-byte base64 key or SPKI PEM. */
async function verifySig(eventPayload: unknown, pubkey: string | null, sigBase64: string | null): Promise<boolean> {
  if (!pubkey || !sigBase64) return false;
  try {
    const { verifyAsync } = await import('@noble/ed25519');
    const message = new TextEncoder().encode(canonicalize(eventPayload));
    const sig = Uint8Array.from(atob(sigBase64), (c) => c.charCodeAt(0));
    if (pubkey.includes('BEGIN')) return false; // PEM keys verified server-side only; treat as unverified here
    const raw = Uint8Array.from(atob(pubkey), (c) => c.charCodeAt(0));
    if (raw.length !== 32) return false;
    return await verifyAsync(sig, message, raw);
  } catch {
    return false;
  }
}

/** Full independent verification of one batch's event chain, in seq order.
 *  `valid` covers payload hashes + prev links + signatures; unsigned events are warnings. */
export async function verifyChainIndependent(links: VerifyEvent[]): Promise<{
  valid: boolean; problems: string[]; warnings: string[];
  signed_events: number; unsigned_events: number;
}> {
  const problems: string[] = [];
  const warnings: string[] = [];
  let signed = 0, unsigned = 0;

  const seqs = links.map((l) => l.seq);
  if (seqs.some((s, i) => s !== i)) {
    return { valid: false, problems: ['seq sequence must be contiguous starting at 0'], warnings, signed_events: 0, unsigned_events: 0 };
  }

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const eventPayload = {
      batch_id: link.batch_id,
      seq: link.seq,
      event_type: link.event_type,
      actor_id: link.actor_id,
      actor_pubkey: link.actor_pubkey ?? null,
      to_stage: link.to_stage ?? null,
      payload: link.payload,
      created_at: link.created_at,
    };

    if (link.payload_hash !== await sha256Hex(canonicalize(eventPayload))) {
      problems.push(`seq ${link.seq}: payload_hash mismatch (payload or hash altered)`);
    }
    if (i === 0) {
      if (link.prev_hash !== null) problems.push('seq 0: genesis prev_hash must be null');
    } else if (link.prev_hash !== await prevHashOf(links[i - 1])) {
      problems.push(`seq ${link.seq}: prev_hash does not match prior event - history broken`);
    }
    if (link.actor_sig) {
      if (!await verifySig(eventPayload, link.actor_pubkey, link.actor_sig)) {
        problems.push(`seq ${link.seq}: invalid actor signature`);
      }
      signed++;
    } else {
      warnings.push(`seq ${link.seq}: unsigned event (server-attested)`);
      unsigned++;
    }
  }
  return { valid: problems.length === 0, problems, warnings, signed_events: signed, unsigned_events: unsigned };
}

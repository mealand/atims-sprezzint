import { canonicalHash, canonicalize } from '@atims/shared';
import { createHash, createPublicKey, verify } from 'node:crypto';
import type { Stage } from '@atims/shared';

/** A full event row as stored (subset of columns used for verification). */
export interface EventRow {
  batch_id: string;
  seq: number;
  event_type: string;
  actor_id: string;
  actor_pubkey: string | null;
  actor_sig: string | null;
  prev_hash: string | null;
  payload_hash: string;
  to_stage: Stage | null;
  payload: unknown;
  created_at: string;
}

/** The canonical payload that is hashed & signed for an event (documented wire format). */
export function eventPayloadFor(e: Pick<EventRow, 'batch_id' | 'seq' | 'event_type' | 'actor_id' | 'actor_pubkey' | 'to_stage' | 'payload' | 'created_at'>) {
  const createdAt =
    typeof e.created_at === 'string' ? e.created_at
    : e.created_at && typeof (e.created_at as { toISOString?: unknown }).toISOString === 'function'
      ? (e.created_at as unknown as Date).toISOString()
      : String(e.created_at);
  return {
    batch_id: e.batch_id,
    seq: e.seq,
    event_type: e.event_type,
    actor_id: e.actor_id,
    actor_pubkey: e.actor_pubkey,
    to_stage: e.to_stage ?? null,
    payload: e.payload,
    // pg returns timestamptz as a JS Date — normalize to the same ISO string that was hashed at insert.
    created_at: createdAt,
  };
}

export function payloadHashOf(eventPayload: unknown): string {
  return canonicalHash(eventPayload);
}

/** Verify an ed25519 signature over the canonical payload against the actor pubkey.
 *  Accepts SPKI PEM or a raw 32-byte public key (base64 of the noble/webcrypto raw form). */
export function verifySig(eventPayload: unknown, pubkey: string | null, sigBase64: string | null): boolean {
  if (!pubkey || !sigBase64) return false;
  try {
    const key = createPublicKey(pubkey);
    return verify(null, Buffer.from(canonicalize(eventPayload)), key, Buffer.from(sigBase64, 'base64'));
  } catch {
    try {
      // Reconstruct SPKI from a raw 32-byte public key (base64 of the noble/webcrypto raw form).
      const rawBytes = Buffer.from(pubkey, 'base64');
      if (rawBytes.length !== 32) return false;
      const spki = Buffer.concat([Buffer.from([
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
      ]), rawBytes]);
      const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
      return verify(null, Buffer.from(canonicalize(eventPayload)), key, Buffer.from(sigBase64, 'base64'));
    } catch {
      return false;
    }
  }
}

/**
 * The exact bytes hashed as `prev_hash` of the *next* event.
 * Public format — changing this is a breaking protocol change.
 */
export function prevHashOf(link: Pick<EventRow, 'batch_id' | 'seq' | 'payload_hash' | 'actor_pubkey' | 'actor_sig'>): string {
  return createHash('sha256')
    .update(canonicalize({
      batch_id: link.batch_id,
      seq: link.seq,
      payload_hash: link.payload_hash,
      actor_pubkey: link.actor_pubkey,
      actor_sig: link.actor_sig,
    }))
    .digest('hex');
}

/** Full-chain verification for one batch, in seq order.
 *  `valid` = hash-chain integrity (payload hashes + prev links).
 *  Unsigned events (server-attested genesis, legacy data) are *warnings*, not failures. */
export function verifyChain(links: EventRow[]) {
  const problems: string[] = [];
  const warnings: string[] = [];
  const seqs = links.map((l) => l.seq);
  if (seqs.some((s, i) => s !== i)) {
    problems.push('seq sequence must be contiguous starting at 0');
    return { valid: false, problems, warnings };
  }
  links.forEach((link, i) => {
    const payload = eventPayloadFor(link);
    if (link.payload_hash !== payloadHashOf(payload)) {
      problems.push(`seq ${link.seq}: payload_hash mismatch (payload or hash altered)`);
    }
    if (i === 0) {
      if (link.prev_hash !== null) problems.push('seq 0: genesis prev_hash must be null');
    } else if (link.prev_hash !== prevHashOf(links[i - 1])) {
      problems.push(`seq ${link.seq}: prev_hash does not match prior event — history broken`);
    }
    if (link.actor_sig) {
      if (!verifySig(payload, link.actor_pubkey, link.actor_sig)) {
        problems.push(`seq ${link.seq}: invalid actor signature`);
      }
    } else {
      warnings.push(`seq ${link.seq}: unsigned event (server-attested)`);
    }
  });
  return { valid: problems.length === 0, problems, warnings };
}

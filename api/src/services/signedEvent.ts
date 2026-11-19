/**
 * Rules for client-signed events (F1).
 *
 * The client signs the exact wire event the server will store. To make that
 * possible the dry-run and the final submission must produce byte-identical
 * wire events, so every field that goes into the wire event (including
 * actor_pubkey, seq and created_at) is fixed by the dry-run and echoed back.
 *
 * Nothing unverified is ever written to the append-only ledger: a bad or
 * missing signature is rejected *before* insert, because a stored bad
 * signature would mark the batch as tampered forever.
 */
import { eventPayloadFor, verifySig } from './chain.js';

/** Max clock skew / dry-run-to-submit delay accepted for a client created_at. */
export const CREATED_AT_WINDOW_MS = 10 * 60_000;

export interface WireInput {
  batchId: string;
  seq: number;
  eventType: string;
  actorId: string;
  actorPubkey: string;
  toStage: string | null;
  payload: unknown;
  createdAt: string;
}

/** The exact object that is hashed (payload_hash) and signed (actor_sig). */
export function buildWireEvent(i: WireInput) {
  return eventPayloadFor({
    batch_id: i.batchId,
    seq: i.seq,
    event_type: i.eventType,
    actor_id: i.actorId,
    actor_pubkey: i.actorPubkey,
    to_stage: (i.toStage ?? null) as never,
    payload: i.payload,
    created_at: i.createdAt,
  });
}

export type Rejection = { status: 400 | 409; code: string; error: string };

/** Raw 32-byte ed25519 public key, base64. The only format both verifiers accept. */
export function checkPubkey(pubkey: unknown): Rejection | null {
  if (typeof pubkey !== 'string' || !pubkey) {
    return { status: 400, code: 'PUBKEY_REQUIRED', error: 'actor_pubkey is required: events must be signed by a device key' };
  }
  const raw = Buffer.from(pubkey, 'base64');
  if (raw.length !== 32 || raw.toString('base64') !== pubkey) {
    return { status: 400, code: 'BAD_PUBKEY', error: 'actor_pubkey must be a base64 raw 32-byte ed25519 public key' };
  }
  return null;
}

/** created_at for a final (signed) submission: required, parseable, recent. Never silently replaced. */
export function resolveSignedCreatedAt(createdAt: unknown, now = Date.now()): { value: string } | Rejection {
  if (typeof createdAt !== 'string' || !createdAt) {
    return { status: 400, code: 'CREATED_AT_REQUIRED', error: 'created_at from the dry-run is required with a signature' };
  }
  const t = new Date(createdAt);
  if (Number.isNaN(t.valueOf())) {
    return { status: 400, code: 'BAD_CREATED_AT', error: 'created_at is not a valid timestamp' };
  }
  if (Math.abs(now - t.valueOf()) > CREATED_AT_WINDOW_MS) {
    return { status: 409, code: 'STALE_EVENT', error: 'signed event expired; request a new dry-run and sign again' };
  }
  return { value: t.toISOString() };
}

/**
 * Validate a final submission against the wire event the server computed.
 * `clientSeq` is the seq the client signed (from the dry-run); if the chain
 * has moved since, the signature can't match, so tell the client to re-sign.
 */
export function checkSignedSubmission(args: {
  wire: ReturnType<typeof buildWireEvent>;
  actorSig: unknown;
  clientSeq: unknown;
}): Rejection | null {
  const { wire, actorSig, clientSeq } = args;
  if (typeof actorSig !== 'string' || !actorSig) {
    return { status: 400, code: 'SIGNATURE_REQUIRED', error: 'actor_sig is required' };
  }
  if (clientSeq !== undefined && clientSeq !== null && Number(clientSeq) !== wire.seq) {
    return { status: 409, code: 'STALE_EVENT', error: 'the batch changed since the dry-run; request a new dry-run and sign again' };
  }
  if (!verifySig(wire, wire.actor_pubkey, actorSig)) {
    return { status: 400, code: 'BAD_SIGNATURE', error: 'signature does not match the event; nothing was recorded' };
  }
  return null;
}

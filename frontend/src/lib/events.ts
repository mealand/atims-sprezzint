/**
 * Client-side signing + append flow (M2.5, fixed in F1).
 * Two-phase: 1) dry-run → server returns the exact wire event it will store
 *            2) sign those exact bytes with the device key → POST final event.
 *
 * The dry-run must carry the same actor_pubkey as the final submission, and the
 * final submission echoes the dry-run's created_at and seq, so the event the
 * server stores is byte-identical to the one that was signed. The server
 * verifies the signature before storing anything.
 */
import { api } from './api';
import { ensureKey, signCanonical } from './keys';

export interface WireEvent {
  batch_id: string; seq: number; event_type: string; actor_id: string;
  actor_pubkey: string | null; to_stage: string | null; payload: unknown; created_at: string;
}

/** Retries when another event lands between dry-run and submit (server answers 409 STALE_EVENT). */
const MAX_ATTEMPTS = 3;

function isStale(err: unknown): boolean {
  return (err as { data?: { code?: string } })?.data?.code === 'STALE_EVENT';
}

export async function appendSignedEvent(
  batchId: string,
  body: { event_type: string; to_stage?: string; payload: unknown },
): Promise<{ event: unknown; batch: unknown }> {
  const key = await ensureKey();
  for (let attempt = 1; ; attempt++) {
    // 1 — dry run with the same public key we will submit, so the wire event matches exactly
    const dry = await api<{ wire_event: WireEvent; payload_hash: string; prev_hash: string | null }>(
      `/batches/${batchId}/events`,
      { method: 'POST', body: { ...body, actor_pubkey: key.pubkeyB64, dry_run: true } },
    );
    // 2 — sign the exact wire event and submit it with the fields that fix its bytes
    const actor_sig = await signCanonical(dry.wire_event, key.seed);
    try {
      return await api(`/batches/${batchId}/events`, {
        method: 'POST',
        body: {
          event_type: body.event_type,
          to_stage: body.to_stage,
          payload: body.payload,
          actor_pubkey: key.pubkeyB64,
          actor_sig,
          created_at: dry.wire_event.created_at,
          seq: dry.wire_event.seq,
        },
      });
    } catch (err) {
      if (isStale(err) && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
}

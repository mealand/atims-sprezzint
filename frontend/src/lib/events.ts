/**
 * Client-side signing + append flow (M2.5).
 * Two-phase: 1) dry-run → server returns the exact wire event + hashes
 *            2) sign those bytes with the device key → POST final event.
 */
import { api } from './api';
import { ensureKey, signCanonical } from './keys';

export interface WireEvent {
  batch_id: string; seq: number; event_type: string; actor_id: string;
  actor_pubkey: string | null; to_stage: string | null; payload: unknown; created_at: string;
}

export async function appendSignedEvent(
  batchId: string,
  body: { event_type: string; to_stage?: string; payload: unknown },
): Promise<{ event: unknown; batch: unknown }> {
  // 1 — dry run: get exact bytes to sign
  const dry = await api<{ wire_event: WireEvent; payload_hash: string; prev_hash: string | null }>(
    `/batches/${batchId}/events`,
    { method: 'POST', body: { ...body, dry_run: true } },
  );
  // 2 — sign and submit final
  const key = await ensureKey();
  const actor_sig = await signCanonical(dry.wire_event);
  return api(`/batches/${batchId}/events`, {
    method: 'POST',
    body: {
      event_type: body.event_type,
      to_stage: body.to_stage,
      payload: body.payload,
      actor_pubkey: key.pubkeyB64,
      actor_sig,
      created_at: dry.wire_event.created_at,
    },
  });
}

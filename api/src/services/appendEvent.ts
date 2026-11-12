/** Shared chain-append helpers used by batches + evidence routes. */
import { query } from '../db/pool.js';
import { canonicalize } from '@atims/shared';
import { createHash } from 'node:crypto';

/** Must stay in sync with services/chain.ts prevHashOf. */
export function sha256Prev(prior: Record<string, unknown>): string {
  return createHash('sha256')
    .update(canonicalize({
      batch_id: prior.batch_id,
      seq: prior.seq,
      payload_hash: prior.payload_hash,
      actor_pubkey: prior.actor_pubkey ?? null,
      actor_sig: prior.actor_sig ?? null,
    }))
    .digest('hex');
}

/** Next seq + prev_hash for the batch (or genesis values when empty). */
export async function nextLink(batchId: string): Promise<{ seq: number; prev_hash: string | null }> {
  const { rows } = await query<{ s: number }>(
    `SELECT COALESCE(MAX(seq), -1) + 1 AS s FROM batch_events WHERE batch_id = $1`, [batchId],
  );
  const seq = Number(rows[0].s);
  if (seq === 0) return { seq, prev_hash: null };
  const prior = (await query<Record<string, unknown>>(
    `SELECT seq, payload_hash, actor_pubkey, actor_sig, batch_id FROM batch_events WHERE batch_id = $1 AND seq = $2`,
    [batchId, seq - 1],
  )).rows[0];
  return { seq, prev_hash: prior ? sha256Prev(prior) : null };
}

/**
 * M5 anchor job — runs on a timer inside the API process.
 *  - submit: batches whose chain has ≥1 event but no anchor yet
 *  - upgrade: submitted anchors pending Bitcoin confirmation
 * Interval is configurable (OTS_ANCHOR_INTERVAL_MS, default 5 min).
 */
import { query } from '../db/pool.js';
import { sha256Prev } from './appendEvent.js';
import { submitDigest, upgradeDigest } from './ots.js';

export function chainHeadHash(batchId: string): Promise<string | null> {
  return (async () => {
    const last = (await query<Record<string, unknown>>(
      `SELECT batch_id, seq, payload_hash, actor_pubkey, actor_sig
       FROM batch_events WHERE batch_id = $1 ORDER BY seq DESC LIMIT 1`, [batchId],
    )).rows[0];
    return last ? sha256Prev(last) : null;
  })();
}

export async function submitPendingAnchors(limit = 20): Promise<number> {
  const batches = (await query<{ id: string }>(
    `SELECT b.id FROM batches b
     WHERE NOT EXISTS (SELECT 1 FROM chain_anchors a WHERE a.batch_id = b.id)
     ORDER BY b.created_at ASC LIMIT $1`, [limit],
  )).rows;
  let done = 0;
  for (const { id } of batches) {
    const head = await chainHeadHash(id);
    if (!head) continue;
    const proof = await submitDigest(head);
    if (!proof) continue;
    await query(
      `INSERT INTO chain_anchors (batch_id, head_hash, ots_proof) VALUES ($1, $2, $3)
       ON CONFLICT (batch_id, head_hash) DO NOTHING`, [id, head, proof],
    );
    done++;
  }
  return done;
}

export async function upgradePendingAnchors(limit = 20): Promise<number> {
  const pending = (await query<{ id: string; batch_id: string; head_hash: string; ots_proof: string | null }>(
    `SELECT id, batch_id, head_hash, ots_proof FROM chain_anchors
     WHERE confirmed_at IS NULL ORDER BY submitted_at ASC LIMIT $1`, [limit],
  )).rows;
  let done = 0;
  for (const a of pending) {
    const up = await upgradeDigest(a.head_hash, a.ots_proof ?? '');
    if (!up) continue;
    await query(
      `UPDATE chain_anchors SET ots_proof = $3, confirmed_at = now(), block_height = $4, upgraded_at = now()
       WHERE id = $1 AND batch_id = $2`, [a.id, a.batch_id, up.proof, up.height],
    );
    done++;
  }
  return done;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startAnchorJob(intervalMs = Number(process.env.OTS_ANCHOR_INTERVAL_MS ?? 5 * 60_000)) {
  if (timer) return;
  timer = setInterval(() => {
    // fire-and-forget; failures are logged and retried next tick
    upgradePendingAnchors().catch((e) => console.error('[anchor-upgrade]', e.message));
    submitPendingAnchors().catch((e) => console.error('[anchor-submit]', e.message));
  }, intervalMs);
  timer.unref?.();
}

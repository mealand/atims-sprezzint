/**
 * Transaction helpers. `Queryable` is the slice of pg.PoolClient the
 * transactional services use, so they can be tested with a fake client.
 */
import type pg from 'pg';
import { sha256Prev } from './appendEvent.js';

export interface Queryable {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

/** Run `fn` on one pooled connection (the caller issues BEGIN/COMMIT), then release it. */
export async function withClient<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
  const { pool } = await import('../db/pool.js');
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** nextLink (appendEvent.ts) on a given connection, so it sees the transaction's locks. */
export async function nextLinkOn(client: Queryable, batchId: string): Promise<{ seq: number; prev_hash: string | null }> {
  const { rows } = await client.query<{ s: number }>(
    `SELECT COALESCE(MAX(seq), -1) + 1 AS s FROM batch_events WHERE batch_id = $1`, [batchId],
  );
  const seq = Number(rows[0].s);
  if (seq === 0) return { seq, prev_hash: null };
  const prior = (await client.query<Record<string, unknown>>(
    `SELECT seq, payload_hash, actor_pubkey, actor_sig, batch_id FROM batch_events WHERE batch_id = $1 AND seq = $2`,
    [batchId, seq - 1],
  )).rows[0];
  return { seq, prev_hash: prior ? sha256Prev(prior) : null };
}

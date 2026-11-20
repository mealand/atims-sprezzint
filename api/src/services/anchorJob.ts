/**
 * Anchor job (M5, fixed in F10). Runs on a timer inside the API process.
 *
 *  - submit:  every batch whose current chain head has no anchor yet. A batch is
 *             re-anchored each time its head changes, not only once.
 *  - refresh: an anchor for a current head that is still unconfirmed after
 *             OTS_STALL_HOURS is submitted again; the new calendar paths are merged
 *             into the stored proof, so nothing already obtained is lost.
 *  - upgrade: unconfirmed anchors, visited round-robin (a cursor over anchor ids) so
 *             proofs that never confirm cannot starve the rest of the queue. Anchors
 *             older than OTS_GIVE_UP_HOURS are no longer polled, and calendar requests
 *             have short timeouts and a per-run deadline.
 *  - one run at a time: a run that is still going when the timer fires again is
 *             skipped (in-process guard), and a Postgres advisory lock keeps two API
 *             instances from running at once.
 *
 * chain_anchors is not the ledger: anchors are external attestations about it, so
 * updating an anchor row never touches batch_events.
 */
import { sha256Prev } from './appendEvent.js';
import { mergeProofs, submitDigest, upgradeDigest } from './ots.js';
import type { Queryable } from './tx.js';

const INTERVAL_MS = Number(process.env.OTS_ANCHOR_INTERVAL_MS ?? 5 * 60_000);
const STALL_HOURS = Number(process.env.OTS_STALL_HOURS ?? 12);
const GIVE_UP_HOURS = Number(process.env.OTS_GIVE_UP_HOURS ?? 72);
const UPGRADE_CONCURRENCY = 4;
/** Arbitrary fixed key for pg_try_advisory_lock, reserved for the anchor job. */
const ADVISORY_LOCK_KEY = '4174617331501520';

async function db(): Promise<Queryable & { connect?: () => Promise<Queryable & { release: () => void }> }> {
  const { pool } = await import('../db/pool.js');
  return pool as never;
}

// ── Heads ─────────────────────────────────────────────────

export interface LastEvent {
  batch_id: string; seq: number; payload_hash: string;
  actor_pubkey: string | null; actor_sig: string | null; created_at?: string | Date;
}

/** The chain head of a batch: the prev_hash its next event would carry (frozen format). */
export const headOf = (last: LastEvent) => sha256Prev(last as unknown as Record<string, unknown>);

export async function chainHeadHash(batchId: string, q?: Queryable): Promise<string | null> {
  const c = q ?? await db();
  const last = (await c.query<LastEvent>(
    `SELECT batch_id, seq, payload_hash, actor_pubkey, actor_sig
       FROM batch_events WHERE batch_id = $1 ORDER BY seq DESC LIMIT 1`, [batchId],
  )).rows[0];
  return last ? headOf(last) : null;
}

/** Current head of every batch that has events. */
export async function currentHeads(q?: Queryable): Promise<Array<{ batch_id: string; head_hash: string; changed_at: number }>> {
  const c = q ?? await db();
  const rows = (await c.query<LastEvent>(
    `SELECT DISTINCT ON (batch_id) batch_id::text AS batch_id, seq, payload_hash, actor_pubkey, actor_sig, created_at
       FROM batch_events ORDER BY batch_id, seq DESC`,
  )).rows;
  return rows.map((r) => ({ batch_id: r.batch_id, head_hash: headOf(r), changed_at: new Date(r.created_at ?? 0).valueOf() }));
}

/**
 * Pure: which batches need an anchor for their current head. `anchored` holds
 * `${batch_id}:${head_hash}` for every anchor row. Oldest change first, so a busy
 * batch cannot crowd out the others.
 */
export function headsToAnchor<T extends { batch_id: string; head_hash: string; changed_at: number }>(
  heads: T[], anchored: Set<string>, limit: number,
): T[] {
  return heads
    .filter((h) => !anchored.has(`${h.batch_id}:${h.head_hash}`))
    .sort((a, b) => a.changed_at - b.changed_at)
    .slice(0, limit);
}

// ── Submit (and refresh stalled anchors of current heads) ─

export async function submitPendingAnchors(limit = 20, q?: Queryable): Promise<number> {
  const c = q ?? await db();
  const heads = await currentHeads(c);
  if (!heads.length) return 0;
  const existing = (await c.query<{ batch_id: string; head_hash: string; ots_proof: string | null; confirmed: boolean; stalled: boolean }>(
    `SELECT batch_id::text AS batch_id, head_hash, ots_proof, confirmed_at IS NOT NULL AS confirmed,
            submitted_at < now() - make_interval(hours => $2::int) AS stalled
       FROM chain_anchors WHERE head_hash = ANY($1::text[])`,
    [heads.map((h) => h.head_hash), Math.max(1, Math.round(STALL_HOURS))],
  )).rows;
  const anchored = new Set(existing.map((a) => `${a.batch_id}:${a.head_hash}`));

  let done = 0;
  for (const h of headsToAnchor(heads, anchored, limit)) {
    const proof = await submitDigest(h.head_hash);
    if (!proof) continue;
    await c.query(
      `INSERT INTO chain_anchors (batch_id, head_hash, ots_proof) VALUES ($1, $2, $3)
       ON CONFLICT (batch_id, head_hash) DO NOTHING`, [h.batch_id, h.head_hash, proof],
    );
    done++;
  }

  // A current head whose proof has not confirmed for STALL_HOURS: the calendar may have
  // lost it. Submit again and merge, keeping the earlier calendar paths.
  const stalled = existing.filter((a) => !a.confirmed && a.stalled).slice(0, Math.max(0, limit - done));
  for (const a of stalled) {
    const fresh = await submitDigest(a.head_hash);
    if (!fresh) continue;
    await c.query(
      `UPDATE chain_anchors SET ots_proof = $3, submitted_at = now()
        WHERE batch_id = $1 AND head_hash = $2 AND confirmed_at IS NULL`,
      [a.batch_id, a.head_hash, mergeProofs(a.head_hash, a.ots_proof, fresh)],
    );
    done++;
  }
  return done;
}

// ── Upgrade (round-robin) ─────────────────────────────────

/** Last anchor id visited; the next run continues after it and wraps around at the end. */
let upgradeCursor: string | null = null;
export const resetUpgradeCursor = () => { upgradeCursor = null; };

interface PendingRow { id: string; batch_id: string; head_hash: string; ots_proof: string | null }

async function nextPendingSlice(c: Queryable, limit: number): Promise<PendingRow[]> {
  const sql = (after: boolean) =>
    `SELECT id::text AS id, batch_id::text AS batch_id, head_hash, ots_proof FROM chain_anchors
      WHERE confirmed_at IS NULL AND ots_proof IS NOT NULL
        AND submitted_at > now() - make_interval(hours => $1::int)
        ${after ? 'AND id > $3::uuid' : ''}
      ORDER BY id LIMIT $2`;
  const hours = Math.max(1, Math.round(GIVE_UP_HOURS));
  let rows = upgradeCursor
    ? (await c.query<PendingRow>(sql(true), [hours, limit, upgradeCursor])).rows
    : (await c.query<PendingRow>(sql(false), [hours, limit])).rows;
  if (rows.length < limit && upgradeCursor) {
    // Reached the end: wrap around for the rest of this slice.
    const seen = new Set(rows.map((r) => r.id));
    const head = (await c.query<PendingRow>(sql(false), [hours, limit - rows.length])).rows.filter((r) => !seen.has(r.id));
    rows = [...rows, ...head];
  }
  upgradeCursor = rows.length ? rows[rows.length - 1].id : null;
  return rows;
}

export async function upgradePendingAnchors(
  limit = 20, q?: Queryable, deadlineMs = Date.now() + INTERVAL_MS * 0.8,
): Promise<number> {
  const c = q ?? await db();
  const pending = await nextPendingSlice(c, limit);
  let done = 0;
  let i = 0;
  const worker = async () => {
    while (i < pending.length && Date.now() < deadlineMs) {
      const a = pending[i++];
      let up: Awaited<ReturnType<typeof upgradeDigest>>;
      try {
        up = await upgradeDigest(a.head_hash, a.ots_proof ?? '');
      } catch (e) {
        console.error(`[anchor-upgrade] unreadable proof for anchor ${a.id}: ${(e as Error).message}`);
        continue;
      }
      if (!up) continue;
      await c.query(
        `UPDATE chain_anchors SET ots_proof = $3, confirmed_at = now(), block_height = $4, upgraded_at = now()
          WHERE id = $1 AND batch_id = $2 AND confirmed_at IS NULL`, [a.id, a.batch_id, up.proof, up.height],
      );
      done++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPGRADE_CONCURRENCY, pending.length) }, worker));
  return done;
}

// ── Runner ────────────────────────────────────────────────

export type RunResult = { skipped: true; reason: string } | { skipped: false; upgraded: number; submitted: number };

/**
 * Wrap the job steps so runs never overlap: a call made while a run is in flight
 * returns { skipped: true } immediately. `lock` (optional) is a cross-process
 * guard; it returns a release function, or null when another process holds it.
 */
export function createAnchorRunner(steps: {
  upgrade: () => Promise<number>;
  submit: () => Promise<number>;
  lock?: () => Promise<(() => Promise<void>) | null>;
  log?: (msg: string) => void;
}): () => Promise<RunResult> {
  let running = false;
  const log = steps.log ?? ((m: string) => console.error(m));
  return async () => {
    if (running) return { skipped: true, reason: 'previous run still in progress' };
    running = true;
    try {
      const release = steps.lock ? await steps.lock() : async () => {};
      if (!release) return { skipped: true, reason: 'another instance is anchoring' };
      try {
        // Upgrade first so a slow submit cannot delay confirmations.
        const upgraded = await steps.upgrade().catch((e) => { log(`[anchor-upgrade] ${(e as Error).message}`); return 0; });
        const submitted = await steps.submit().catch((e) => { log(`[anchor-submit] ${(e as Error).message}`); return 0; });
        return { skipped: false, upgraded, submitted };
      } finally {
        await release().catch(() => {});
      }
    } finally {
      running = false;
    }
  };
}

/** Postgres advisory lock on a dedicated connection, so two API instances never anchor at once. */
async function advisoryLock(): Promise<(() => Promise<void>) | null> {
  const pool = await db();
  if (!pool.connect) return async () => {};
  const client = await pool.connect();
  try {
    const got = (await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1::bigint) AS ok`, [ADVISORY_LOCK_KEY])).rows[0]?.ok;
    if (!got) { client.release(); return null; }
  } catch (e) {
    client.release();
    throw e;
  }
  return async () => {
    try { await client.query(`SELECT pg_advisory_unlock($1::bigint)`, [ADVISORY_LOCK_KEY]); }
    finally { client.release(); }
  };
}

export const runAnchorJob = createAnchorRunner({
  upgrade: () => upgradePendingAnchors(),
  submit: () => submitPendingAnchors(),
  lock: advisoryLock,
});

let timer: ReturnType<typeof setInterval> | null = null;
export function startAnchorJob(intervalMs = INTERVAL_MS) {
  if (timer) return;
  timer = setInterval(() => {
    runAnchorJob().catch((e) => console.error('[anchor-job]', (e as Error).message));
  }, intervalMs);
  timer.unref?.();
}

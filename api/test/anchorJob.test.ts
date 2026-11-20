/**
 * F10: re-anchor whenever a batch's head changes, never run twice at once, and
 * keep the upgrade queue moving past proofs that never confirm.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { canonicalize } from '@atims/shared';
import { createHash } from 'node:crypto';
import type { Queryable } from '../src/services/tx.js';

process.env.JWT_SECRET ??= 'test-secret-at-least-16-chars';
process.env.NODE_ENV ??= 'test';

type Mod = typeof import('../src/services/anchorJob.js');
let m: Mod;
beforeAll(async () => { m = await import('../src/services/anchorJob.js'); });

const last = (seq: number) => ({ batch_id: 'b1', seq, payload_hash: `h${seq}`, actor_pubkey: null, actor_sig: null });

describe('chain head', () => {
  it('is the prev_hash the next event would carry (frozen format)', () => {
    const l = last(3);
    const expected = createHash('sha256').update(canonicalize({
      batch_id: 'b1', seq: 3, payload_hash: 'h3', actor_pubkey: null, actor_sig: null,
    })).digest('hex');
    expect(m.headOf(l)).toBe(expected);
  });

  it('changes when the chain grows, so the batch is anchored again', () => {
    const anchored = new Set([`b1:${m.headOf(last(3))}`]);
    const before = [{ batch_id: 'b1', head_hash: m.headOf(last(3)), changed_at: 1 }];
    const after = [{ batch_id: 'b1', head_hash: m.headOf(last(4)), changed_at: 2 }];
    expect(m.headsToAnchor(before, anchored, 10)).toHaveLength(0);
    expect(m.headsToAnchor(after, anchored, 10)).toEqual(after);
  });

  it('serves the oldest change first and respects the limit', () => {
    const heads = [
      { batch_id: 'a', head_hash: 'x', changed_at: 30 },
      { batch_id: 'b', head_hash: 'y', changed_at: 10 },
      { batch_id: 'c', head_hash: 'z', changed_at: 20 },
    ];
    expect(m.headsToAnchor(heads, new Set(), 2).map((h) => h.batch_id)).toEqual(['b', 'c']);
  });
});

describe('runner re-entrancy guard', () => {
  it('skips a run while the previous one is still going', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let upgrades = 0;
    const run = m.createAnchorRunner({
      upgrade: async () => { upgrades++; await gate; return 1; },
      submit: async () => 2,
      log: () => {},
    });
    const first = run();
    const second = await run();
    expect(second).toEqual({ skipped: true, reason: 'previous run still in progress' });
    release();
    expect(await first).toEqual({ skipped: false, upgraded: 1, submitted: 2 });
    expect(upgrades).toBe(1);
    // Free again once the first run finished.
    expect((await run()).skipped).toBe(false);
  });

  it('releases the guard and the lock even when a step throws', async () => {
    let released = 0;
    const run = m.createAnchorRunner({
      upgrade: async () => { throw new Error('calendar down'); },
      submit: async () => 0,
      lock: async () => async () => { released++; },
      log: () => {},
    });
    expect(await run()).toEqual({ skipped: false, upgraded: 0, submitted: 0 });
    expect(await run()).toEqual({ skipped: false, upgraded: 0, submitted: 0 });
    expect(released).toBe(2);
  });

  it('skips when another instance holds the lock', async () => {
    const run = m.createAnchorRunner({ upgrade: async () => 1, submit: async () => 1, lock: async () => null, log: () => {} });
    expect(await run()).toEqual({ skipped: true, reason: 'another instance is anchoring' });
  });
});

describe('upgrade queue', () => {
  /** A fake chain_anchors table with stalled (never-confirming) proofs. */
  function fakeDb(ids: string[]) {
    const asked: string[][] = [];
    const db: Queryable = {
      async query<T>(text: string, params: unknown[] = []) {
        if (/FROM chain_anchors/.test(text)) {
          const limit = Number(params[1]);
          const after = /id > \$3/.test(text) ? String(params[2]) : null;
          const rows = ids.filter((id) => after === null || id > after).slice(0, limit)
            // An unreadable proof: upgradeDigest throws, which is the fastest "stalled" case.
            .map((id) => ({ id, batch_id: 'b', head_hash: 'ab'.repeat(32), ots_proof: Buffer.from([0x99]).toString('base64') }));
          asked.push(rows.map((r) => r.id));
          return { rows: rows as T[] };
        }
        return { rows: [] as T[] };
      },
    };
    return { db, asked };
  }

  it('visits every pending anchor round-robin instead of retrying the same head of the queue', async () => {
    m.resetUpgradeCursor();
    const ids = ['01', '02', '03', '04', '05'].map((n) => `00000000-0000-0000-0000-0000000000${n}`);
    const { db, asked } = fakeDb(ids);
    const err = console.error;
    console.error = () => {};
    try {
      await m.upgradePendingAnchors(2, db);
      await m.upgradePendingAnchors(2, db);
      await m.upgradePendingAnchors(2, db);
    } finally { console.error = err; }
    const visited = asked.flat();
    expect(new Set(visited)).toEqual(new Set(ids));
    expect(asked[0]).toEqual([ids[0], ids[1]]);
    expect(asked[1]).toEqual([ids[2], ids[3]]);
    // third slice: the last one, then wraps around to the start
    expect(asked.slice(2).flat()).toEqual([ids[4], ids[0]]);
  });
});

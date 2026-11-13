/** One-off: anchor all pending batches now + report status. Run: npx tsx src/services/otsNow.ts */
import 'dotenv/config';
import { query } from '../db/pool.js';
import { chainHeadHash, submitPendingAnchors, upgradePendingAnchors } from './anchorJob.js';

const submitted = await submitPendingAnchors(50);
console.log(`submitted: ${submitted}`);
const upgraded = await upgradePendingAnchors(50);
console.log(`upgraded: ${upgraded}`);
const rows = (await query(
  `SELECT b.trace_id, a.head_hash, a.confirmed_at, a.block_height, a.ots_proof IS NOT NULL AS has_proof
   FROM chain_anchors a JOIN batches b ON b.id = a.batch_id ORDER BY a.submitted_at DESC LIMIT 10`,
)).rows;
console.table(rows.map((r) => ({ ...r, head: String(r.head_hash).slice(0, 12) + '…' })));
process.exit(0);

#!/usr/bin/env node
/**
 * atims-verify — standalone third-party verifier.
 * Fetches the RAW event chain from an ATiMs instance and recomputes every
 * payload hash, prev_hash link and ed25519 signature locally using
 * @atims/shared — the server's own verdict is NOT trusted.
 *
 * Usage: npx atims-verify <api-url> <batch-id-or-trace-id>
 *   e.g. npx atims-verify http://localhost:3000 CROP-2026-E8189B9C
 */
import { verifyChainIndependent, type VerifyEvent } from '@atims/shared';

const [url, batch] = process.argv.slice(2);
if (!url || !batch) {
  console.error('Usage: atims-verify <api-url> <batch-id-or-trace-id>');
  process.exit(2);
}

const res = await fetch(`${url.replace(/\/$/, '')}/verify/${batch}`);
if (!res.ok) {
  console.error(`✗ ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { trace_id, events } = (await res.json()) as { trace_id: string; events: VerifyEvent[] };

const result = await verifyChainIndependent(events);

console.log(`atims-verify · batch ${trace_id} (${events.length} events)`);
for (const w of result.warnings) console.log(`  ⚠ ${w}`);
if (result.valid) {
  console.log(`✓ Chain valid — all ${events.length} payload hashes, prev_hash links` +
    ` and ${result.signed_events} signature(s) recomputed locally. ` +
    `${result.unsigned_events} unsigned (server-attested) event(s) noted as warnings.`);
} else {
  console.error('✗ CHAIN INVALID (recomputed locally, independent of the server):');
  for (const p of result.problems) console.error('  - ' + p);
  process.exit(1);
}

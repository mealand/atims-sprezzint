#!/usr/bin/env node
/**
 * atims-verify — standalone third-party verifier.
 * Fetches a batch event chain from an ATiMs instance and verifies hashes
 * and signature-linked invariants WITHOUT trusting the server.
 *
 * Usage: npx atims-verify <api-url> <batch-id-or-trace-id>
 */
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
const out = await res.json();
if (out.valid) {
  console.log('✓ Chain valid — all payload hashes, prev_hash links and signatures consistent.');
} else {
  console.error('✗ CHAIN INVALID:');
  for (const p of out.problems) console.error('  - ' + p);
  process.exit(1);
}

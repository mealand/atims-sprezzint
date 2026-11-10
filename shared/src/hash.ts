import { createHash } from 'node:crypto';
import { canonicalize } from './canonical.js';

/** SHA-256 hex of the canonical JSON of any value — one hashing rule for the entire system. */
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

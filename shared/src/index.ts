// Browser-safe exports only — node:crypto-dependent code (hash.ts) must NOT
// be re-exported here; node consumers import '@atims/shared/hash' explicitly.
export { canonicalize } from './canonical.js';
export * from './types.js';

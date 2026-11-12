// Node consumers: browser-safe exports + node:crypto-dependent hashing.
export { canonicalize } from './canonical.js';
export { verifyChainIndependent, type VerifyEvent } from './verify.js';
export * from './types.js';
export * from './hash.js';

/**
 * Canonical JSON serialisation (RFC 8785-style subset).
 * Deterministic across implementations: sorted keys, no insignificant
 * whitespace, minimal number formatting, undefined dropped.
 * This is THE correctness-critical function of the ledger — property-tested.
 */
export function canonicalize(value: unknown, depth = 0): string {
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('non-finite number is not canonicalisable');
      return numberToString(value);
    case 'bigint': throw new TypeError('bigint is not canonicalisable');
    case 'object': {
      if (value === null) return 'null';
      if (depth > 64) throw new Error('canonicalisation depth exceeded');
      if (Array.isArray(value)) {
        return '[' + value.map((v) => canonicalize(v, depth + 1)).join(',') + ']';
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return '{' + entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v, depth + 1)}`).join(',') + '}';
    }
    default:
      throw new TypeError(`type ${typeof value} is not canonicalisable`);
  }
}

/** Shortest reproducible ECMAScript number form; integers plain, no exponent padding games. */
function numberToString(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  return String(n);
}

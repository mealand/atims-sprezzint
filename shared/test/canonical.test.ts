import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { canonicalize } from '../src/canonical.js';
import { canonicalHash } from '../src/hash.js';

describe('canonicalize', () => {
  it('sorts object keys', () => {
    expect(canonicalize({ b: 1, a: [] })).toBe('{"a":[],"b":1}');
  });

  it('drops undefined and collapses identical structures', () => {
    expect(canonicalize({ a: undefined, b: [1, { c: 'x' }] }))
      .toBe(canonicalize({ b: [1, { c: 'x' }] }));
  });

  it('is stable across key-insertion order (the tamper test)', () => {
    expect(canonicalHash({ p: 'a', q: 'b' })).toBe(canonicalHash({ q: 'b', p: 'a' }));
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize(NaN)).toThrow(TypeError);
  });

  it('property: identical structure ⇒ identical canonical form, always', () => {
    const arb = fc.unicodeJsonValue();
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.string({ minLength: 1 }), arb), { maxItems: 12 }),
        (pairs) => {
          // De-duplicate via Map (JSON objects can't have duplicate keys anyway).
          const entries = [...new Map(pairs).entries()];
          const source = Object.fromEntries(entries);
          const shuffled = Object.fromEntries([...entries].reverse());
          return canonicalize(source) === canonicalize(shuffled);
        },
      ),
    );
  });
});

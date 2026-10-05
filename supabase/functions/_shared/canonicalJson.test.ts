import { describe, expect, it } from 'vitest';
import { canonicalize } from './canonicalJson';

describe('canonical JSON', () => {
  it('sorts object keys by deterministic code-unit order including non-ASCII keys', () => {
    expect(canonicalize({ '😀': 1, z: 2, A: 3, ä: 4 })).toBe('{"A":3,"z":2,"ä":4,"😀":1}');
  });

  it('sorts nested objects while preserving array order', () => {
    expect(canonicalize({ b: [{ y: 2, x: 1 }], a: true })).toBe('{"a":true,"b":[{"x":1,"y":2}]}');
  });
});

import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalKeccak } from './canonical';

describe('RFC 8785-shaped commitments', () => {
  it('sorts object keys recursively and hashes the exact UTF-8 payload', () => {
    const left = { wallet: '0xabc', nested: { z: 2, a: 1 }, method: 'pickup' };
    const right = { method: 'pickup', nested: { a: 1, z: 2 }, wallet: '0xabc' };
    expect(canonicalJson(left)).toBe('{"method":"pickup","nested":{"a":1,"z":2},"wallet":"0xabc"}');
    expect(canonicalKeccak(left)).toBe(canonicalKeccak(right));
  });
});

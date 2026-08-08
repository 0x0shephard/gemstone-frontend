import { describe, expect, it } from 'vitest';
import {
  formatGiftCode,
  generateGiftCode,
  hashGiftCode,
  maskEmail,
  normalizeGiftCode,
} from './gift.ts';

describe('gift code generation', () => {
  it('never emits a character Crockford excludes', () => {
    // I, L, O and U are the whole reason for this alphabet. If any of them can
    // be generated, folding them on input maps a real code onto a different
    // one, and the card stops working.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(generateGiftCode()).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/);
    }
  });

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 500 }, generateGiftCode));
    expect(codes.size).toBe(500);
  });

  it('round-trips through its printed form', () => {
    const code = generateGiftCode();
    expect(normalizeGiftCode(formatGiftCode(code))).toBe(code);
  });
});

describe('gift code normalisation', () => {
  it('accepts the code however it was written down', () => {
    const code = 'ABCD1234EFGH5678';
    for (const written of [
      code,
      code.toLowerCase(),
      'ABCD-1234-EFGH-5678',
      'abcd 1234 efgh 5678',
      '  ABCD-1234 efgh5678  ',
    ]) {
      expect(normalizeGiftCode(written)).toBe(code);
    }
  });

  it('folds the characters Crockford treats as equivalent', () => {
    // Someone reading a printed card aloud says "oh" for zero and "ell" for
    // one. Both have to resolve to the code that was actually issued.
    expect(normalizeGiftCode('OBCD1234EFGH567I')).toBe('0BCD1234EFGH5671');
    expect(normalizeGiftCode('LBCD1234EFGH5678')).toBe('1BCD1234EFGH5678');
  });

  it('rejects anything that is not a well-formed code', () => {
    expect(normalizeGiftCode('ABCD1234EFGH567')).toBeNull(); // too short
    expect(normalizeGiftCode('ABCD1234EFGH56789')).toBeNull(); // too long
    expect(normalizeGiftCode('UBCD1234EFGH5678')).toBeNull(); // U has no fold
    expect(normalizeGiftCode('')).toBeNull();
    expect(normalizeGiftCode(undefined)).toBeNull();
    expect(normalizeGiftCode(42)).toBeNull();
  });
});

describe('gift code hashing', () => {
  it('is stable, and distinct per code', async () => {
    const first = await hashGiftCode('ABCD1234EFGH5678');
    expect(await hashGiftCode('ABCD1234EFGH5678')).toBe(first);
    expect(await hashGiftCode('ABCD1234EFGH5679')).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is domain-separated, so a bare digest of the code will not match', async () => {
    const bare = await crypto.subtle
      .digest('SHA-256', new TextEncoder().encode('ABCD1234EFGH5678'))
      .then((digest) =>
        [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      );
    expect(await hashGiftCode('ABCD1234EFGH5678')).not.toBe(bare);
  });
});

describe('email masking', () => {
  it('shows enough to recognise, not enough to publish', () => {
    expect(maskEmail('charlotte@example.com')).toBe('c•••••••e@example.com');
    expect(maskEmail('jo@example.com')).toBe('j•@example.com');
  });

  it('always masks something, even where there is nothing to hide', () => {
    // A one-character local part would otherwise be printed in full. Emitting a
    // dot regardless costs nothing and stops the mask from revealing, by its
    // own shape, that the address is unusually short.
    expect(maskEmail('a@example.com')).toBe('a•@example.com');
  });

  it('does not throw on input that is not an address', () => {
    expect(maskEmail('not-an-email')).toBe('•••');
  });
});

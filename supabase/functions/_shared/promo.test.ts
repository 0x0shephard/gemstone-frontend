import { describe, expect, it } from 'vitest';
import { normalizePromoCode, promoErrorMessage } from './promo';

describe('promo codes', () => {
  it('accepts the code however it is typed', () => {
    expect(normalizePromoCode('first100')).toBe('FIRST100');
    expect(normalizePromoCode(' First-100 ')).toBe('FIRST100');
  });

  it('refuses anything that is not 4–32 letters and digits', () => {
    expect(normalizePromoCode('abc')).toBeNull();
    expect(normalizePromoCode('FIRST_100')).toBeNull();
    expect(normalizePromoCode('A'.repeat(33))).toBeNull();
    expect(normalizePromoCode(100)).toBeNull();
  });

  it('maps every database refusal to user text', () => {
    for (const [raw, state] of [
      ['promo_closed', 'closed'],
      ['promo_sold_out', 'sold_out'],
      ['promo_already_claimed', 'already_claimed'],
      ['promo_not_found', 'not_found'],
    ] as const) {
      expect(promoErrorMessage(`P0001: ${raw}`)?.state).toBe(state);
    }
    expect(promoErrorMessage('deadlock detected')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { claimWalletMismatch, normalizePromoCode, promoErrorMessage } from './promo';

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

describe('claim wallet binding', () => {
  const recorded = '0xc43aa0f3b4406576cda673c192559de48e38782a';

  it('accepts the recorded wallet in any letter case', () => {
    expect(claimWalletMismatch(recorded, '0xC43AA0f3B4406576CDA673C192559de48e38782a')).toBeNull();
  });

  it('refuses any other wallet and names the recorded one', () => {
    expect(claimWalletMismatch(recorded, '0xb72dc001f39f9a4a8e1ca1cd4271060860e56742')).toBe(
      'This claim was made for wallet 0xc43a…782a. Make it your primary wallet again to receive the stone.',
    );
  });
});

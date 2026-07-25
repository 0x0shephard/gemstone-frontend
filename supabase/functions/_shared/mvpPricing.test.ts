import { describe, expect, it } from 'vitest';
import { calculateMvpPriceUsd } from './mvpPricingMath.ts';

const USD = 10n ** 18n;

describe('MVP seller pricing', () => {
  it('rounds fractional USD up', () => {
    expect(calculateMvpPriceUsd(1.000_001)).toBe(501n * USD);
  });

  it('enforces lower and upper testnet bounds', () => {
    expect(calculateMvpPriceUsd(0.01)).toBe(100n * USD);
    expect(calculateMvpPriceUsd(100)).toBe(25_000n * USD);
  });

  it('rejects invalid carat weights', () => {
    for (const value of [0, -1, Number.NaN, 100_001]) {
      expect(() => calculateMvpPriceUsd(value)).toThrow(
        'Carat weight must be between 0 and 100,000',
      );
    }
  });
});

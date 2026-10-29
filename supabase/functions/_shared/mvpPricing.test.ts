import { describe, expect, it } from 'vitest';
import { keccak256, toBytes } from 'viem';
import { canonicalize } from './canonicalJson.ts';
import { calculateMvpPriceUsd, mvpPricingMatrix } from './mvpPricingMath.ts';

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

describe('MVP pricing matrix network', () => {
  // The document Sepolia valuations were committed with, before `network` was
  // derived from the chain. Its hash is `valuationMatrixHash` on those gems.
  const COMMITTED_SEPOLIA_MATRIX = {
    schemaVersion: 'digital-carat-pricing-matrix/v1',
    method: 'mvp-flat-carat-v1',
    unitPriceUsd: '500',
    minimumUsd: '100',
    maximumUsd: '25000',
    rounding: 'ceil-whole-usd',
    network: 'ethereum-sepolia',
  };
  const hash = (value: unknown) => keccak256(toBytes(canonicalize(value)));

  it('reproduces the committed Sepolia document, so its matrix hash is unchanged', () => {
    expect(mvpPricingMatrix(11155111)).toEqual(COMMITTED_SEPOLIA_MATRIX);
    expect(hash(mvpPricingMatrix(11155111))).toBe(hash(COMMITTED_SEPOLIA_MATRIX));
  });

  it('names the configured test network instead of always saying Sepolia', () => {
    expect(mvpPricingMatrix(421614).network).toBe('arbitrum-sepolia');
    expect(mvpPricingMatrix(31337).network).toBe('local-anvil');
  });

  it('refuses the test-only $500/ct rule on a production chain', () => {
    expect(() => mvpPricingMatrix(42161)).toThrow(/lab appraisal is required/);
    expect(() => mvpPricingMatrix(1)).toThrow(/lab appraisal is required/);
  });
});

import { describe, expect, it } from 'vitest';
import { reserveShortfallUsd } from './gem';
import type { Gem } from '@/services/types';

const USD = 10n ** 18n;

function gem(overrides: Partial<Gem> = {}): Gem {
  return {
    value: 3_672,
    reserve: 0,
    reserveShortfallUsd: 0n,
    ...overrides,
  } as Gem;
}

/**
 * The deployed bracket table is 1000 bps below $1,000 and 400 bps above it. The
 * old implementation assumed a flat 800 bps, which matches neither — so quoted
 * totals were understated on small stones and doubled on large ones. Reading the
 * chain's own figure is the only thing that tracks a bracket change.
 */
describe('reserveShortfallUsd', () => {
  it('reports the shortfall the chain calculated, not a re-derived ratio', () => {
    // $3,672 in the 400 bps bracket: the real requirement is $146.88, whereas a
    // flat 800 bps would have quoted $293.76.
    expect(reserveShortfallUsd(gem({ reserveShortfallUsd: (14_688n * USD) / 100n }))).toBeCloseTo(
      146.88,
      2,
    );
  });

  it('reports zero once a reserve is fully funded', () => {
    expect(reserveShortfallUsd(gem({ reserve: 100, reserveShortfallUsd: 0n }))).toBe(0);
  });

  it('does not scale with the gem price', () => {
    // Proves the value is passed through rather than computed from `value`,
    // which is what let a hardcoded ratio drift away from the bracket table.
    const shortfall = 25n * USD;
    expect(reserveShortfallUsd(gem({ value: 100, reserveShortfallUsd: shortfall }))).toBe(25);
    expect(reserveShortfallUsd(gem({ value: 50_000, reserveShortfallUsd: shortfall }))).toBe(25);
  });

  it('keeps sub-dollar precision', () => {
    expect(reserveShortfallUsd(gem({ reserveShortfallUsd: (5n * USD) / 2n }))).toBe(2.5);
  });
});

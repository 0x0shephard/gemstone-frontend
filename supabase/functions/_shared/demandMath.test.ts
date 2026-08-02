import { describe, expect, it } from 'vitest';
import { aggregateDemand, planScanRanges, totalFor, type BidObservation } from './demandMath.ts';
import { marketMultiplier } from './valuationMath.ts';
import { PPM, VALUATION_MATRIX } from './valuationMatrix.ts';

const bid = (overrides: Partial<BidObservation> = {}): BidObservation => ({
  gemId: '1',
  bidder: '0xaaa',
  observedAt: '2026-07-01T00:00:00.000Z',
  shape: 'Cabochon',
  color: 'Green',
  colorGrade: null,
  ...overrides,
});

describe('demand aggregation', () => {
  it('counts each bid once per criterion', () => {
    const demand = aggregateDemand([bid(), bid({ shape: 'Oval' }), bid()]);
    expect(demand.shape).toEqual({ cabochon: 2, oval: 1 });
    expect(demand.color).toEqual({ green: 3 });
  });

  it('normalises to the keys the engine looks up', () => {
    // The engine lowercases and trims before lookup; a mismatch here silently
    // reads as zero demand rather than erroring.
    const demand = aggregateDemand([bid({ shape: '  DIAMOND Cut ' })]);
    expect(demand.shape).toEqual({ 'diamond cut': 1 });

    const detail = marketMultiplier('shape', 'diamond cut', VALUATION_MATRIX.shapes, demand.shape!);
    expect(detail.observed).toBe(1);
  });

  it('skips absent attributes rather than counting them as a choice', () => {
    const demand = aggregateDemand([bid({ colorGrade: null }), bid({ colorGrade: '' })]);
    expect(demand.colorGrade).toEqual({});
    expect(totalFor(demand, 'colorGrade')).toBe(0);
  });

  it('excludes bids older than the window', () => {
    const demand = aggregateDemand(
      [
        bid({ observedAt: '2026-01-01T00:00:00.000Z' }),
        bid({ observedAt: '2026-07-01T00:00:00.000Z' }),
      ],
      { since: new Date('2026-06-01T00:00:00.000Z') },
    );
    expect(totalFor(demand, 'shape')).toBe(1);
  });

  it('can collapse a bidding war to one vote per bidder per stone', () => {
    // Two parties trading twelve bids on a single lot would otherwise dominate
    // the shape criterion on their own.
    const war = Array.from({ length: 12 }, (_, index) =>
      bid({ gemId: '7', bidder: index % 2 === 0 ? '0xaaa' : '0xbbb' }),
    );
    expect(totalFor(aggregateDemand(war), 'shape')).toBe(12);
    expect(totalFor(aggregateDemand(war, { mode: 'per-bidder-per-gem' }), 'shape')).toBe(2);
  });

  it('treats bidder addresses case-insensitively when de-duplicating', () => {
    const bids = [bid({ bidder: '0xAAA' }), bid({ bidder: '0xaaa' })];
    expect(totalFor(aggregateDemand(bids, { mode: 'per-bidder-per-gem' }), 'shape')).toBe(1);
  });

  it('produces a neutral multiplier from an empty history', () => {
    const demand = aggregateDemand([]);
    const detail = marketMultiplier('shape', 'round', VALUATION_MATRIX.shapes, demand.shape!);
    expect(detail.multiplierPpm).toBe(PPM);
  });
});

describe('scan range planning', () => {
  it('covers the span contiguously with no gaps or overlaps', () => {
    const ranges = planScanRanges(100n, 3_500n, 1_000n);
    expect(ranges[0].from).toBe(100n);
    expect(ranges[ranges.length - 1].to).toBe(3_500n);
    ranges.slice(1).forEach((range, index) => {
      expect(range.from).toBe(ranges[index].to + 1n);
    });
  });

  it('never exceeds the provider span cap', () => {
    for (const range of planScanRanges(0n, 5_000n, 1_000n)) {
      expect(range.to - range.from + 1n).toBeLessThanOrEqual(1_000n);
    }
  });

  it('handles a span shorter than one chunk', () => {
    expect(planScanRanges(10n, 20n, 1_000n)).toEqual([{ from: 10n, to: 20n }]);
  });

  it('rejects a non-positive span instead of looping forever', () => {
    expect(() => planScanRanges(0n, 10n, 0n)).toThrow(/must be positive/i);
  });
});

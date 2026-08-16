import { describe, expect, it } from 'vitest';
import {
  aggregateDemand,
  isRateLimited,
  narrowedSpan,
  planScanRanges,
  suggestedSpan,
  totalFor,
  type BidObservation,
} from './demandMath.ts';
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

/*
 * Verbatim rejections from the three providers this has actually been pointed
 * at. Paraphrasing them would test the regex against itself; the whole point is
 * that real wording is messier than the shape you would invent.
 */
const ALCHEMY =
  'JSON is not a valid request object. — Under the Free tier plan, you can make ' +
  'eth_getLogs requests with up to a 10 block range. Based on your parameters, this ' +
  'block range should work: [0xad10d9, 0xad10e2]. Upgrade to PAYG for expanded block range.';
const THIRDWEB = 'Log response size exceeded. Maximum allowed number of requested blocks is 1000';
const DRPC = 'ranges over 10000 blocks are not supported on free plan';

describe('reading a provider span cap out of its rejection', () => {
  it('prefers the explicit range a provider offers', () => {
    // [0xad10d9, 0xad10e2] is ten blocks inclusive, and agrees with the prose.
    expect(suggestedSpan(ALCHEMY)).toBe(10n);
  });

  it('reads a cap stated only in prose', () => {
    expect(suggestedSpan(THIRDWEB)).toBe(1_000n);
    expect(suggestedSpan(DRPC)).toBe(10_000n);
  });

  it('finds nothing in an error that is not about range', () => {
    expect(suggestedSpan('execution reverted')).toBeNull();
    expect(suggestedSpan('502 Bad Gateway')).toBeNull();
  });
});

describe('narrowing after a rejected chunk', () => {
  it('drops straight to the provider cap instead of halving toward it', () => {
    // This is the bug that stopped the sweep: halving from 1,000 bottomed out at
    // a 64-block floor and threw, while the provider would only ever accept 10.
    expect(narrowedSpan(1_000n, ALCHEMY)).toBe(10n);
  });

  it('halves when the provider explains nothing', () => {
    expect(narrowedSpan(1_000n, 'connection reset')).toBe(500n);
  });

  it('ignores a cap wider than the width just refused', () => {
    // A 1,000-block cap cannot explain a 500-block chunk being rejected, so the
    // refusal is about something else and widening would loop forever.
    expect(narrowedSpan(500n, THIRDWEB)).toBe(250n);
  });

  it('gives up at a single block rather than retrying an outage forever', () => {
    expect(narrowedSpan(2n, 'connection reset')).toBe(1n);
    expect(narrowedSpan(1n, 'connection reset')).toBeNull();
  });
});

describe('telling a rate limit from a range cap', () => {
  it('recognises the throughput limits providers actually send', () => {
    // Verbatim from Alchemy, which is what failed the scheduled run.
    expect(
      isRateLimited(
        'RPC Request failed. — Your app has exceeded its compute units per second capacity.',
      ),
    ).toBe(true);
    expect(isRateLimited('HTTP request failed. — Too Many Requests')).toBe(true);
    expect(isRateLimited('429 Too Many Requests')).toBe(true);
  });

  it('does not mistake a range cap for a rate limit', () => {
    // These two need opposite responses, and the range caps are the ones with
    // numbers in them — easy to match by accident.
    expect(isRateLimited(ALCHEMY)).toBe(false);
    expect(isRateLimited(THIRDWEB)).toBe(false);
    expect(isRateLimited(DRPC)).toBe(false);
  });

  it('does not mistake an ordinary failure for a rate limit', () => {
    expect(isRateLimited('execution reverted')).toBe(false);
    expect(isRateLimited('connection reset')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { purchaseQuote, reserveShortfallUsd, shortfallLabel } from './gem';
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

describe('shortfallLabel', () => {
  /**
   * The regression this exists for. `reserve` is the percentage funded, and it
   * used to be printed straight after the word "Short" — so a stone needing
   * four tenths of a cent announced itself as "Short 99.99%".
   */
  it('reports the gap, not the funded amount', () => {
    expect(shortfallLabel(99.99)).toBe('Short 0.01%');
    expect(shortfallLabel(45)).toBe('Short 55%');
    expect(shortfallLabel(0)).toBe('Short 100%');
  });

  it('never rounds a real shortfall away to zero', () => {
    // "Short 0%" on an underfunded gem would claim it is ready to trade.
    expect(shortfallLabel(99.999)).toBe('Short <0.01%');
  });

  it('does not go negative when the reserve is over-funded', () => {
    expect(shortfallLabel(100)).toBe('Short 0%');
    expect(shortfallLabel(140)).toBe('Short 0%');
  });
});

/**
 * The audit finding this exists for: the buy modal quoted `value`, the approved
 * valuation, while `Marketplace.buy` charges `listings(tokenId).priceUsd`, the
 * seller's ask. Listings may be set up to 1.5× the valuation, so a buyer could
 * be shown $1,000 and authorise $1,500 — with the approval built from the real
 * figure, so nothing downstream objected.
 */
describe('purchaseQuote', () => {
  it('charges the seller ask on a secondary sale, not the valuation', () => {
    const listed = gem({ value: 1_000, listedPrice: 1_500 });
    expect(purchaseQuote(listed, 'buy').priceUsd).toBe(1_500);
    expect(purchaseQuote(listed, 'buy').totalUsd).toBe(1_500);
  });

  it('charges the registry price on a primary sale', () => {
    // No listing exists before the first sale, so `value` is the price and the
    // absence of `listedPrice` is not a missing fact.
    const primary = gem({ value: 1_000, listedPrice: undefined });
    expect(purchaseQuote(primary, 'buyNow').priceUsd).toBe(1_000);
    expect(purchaseQuote(primary, 'buyNow').priced).toBe(true);
  });

  it('ignores the valuation entirely once a stone is listed below it', () => {
    // The mismatch runs both ways: quoting the valuation would overstate the
    // cost here, which is less harmful but no more correct.
    expect(purchaseQuote(gem({ value: 5_000, listedPrice: 3_000 }), 'buy').priceUsd).toBe(3_000);
  });

  it('adds the reserve shortfall to both kinds of sale', () => {
    const short = gem({ value: 1_000, listedPrice: 1_200, reserveShortfallUsd: 40n * USD });
    expect(purchaseQuote(short, 'buy').totalUsd).toBe(1_240);
    expect(purchaseQuote(short, 'buyNow').totalUsd).toBe(1_040);
  });

  it('refuses to price a secondary sale with no ask rather than guessing', () => {
    // Falling back to `value` here is exactly the bug. Reporting the purchase as
    // unpriced lets the caller block it instead of quoting a number the contract
    // will not honour.
    const quote = purchaseQuote(gem({ value: 1_000, listedPrice: undefined }), 'buy');
    expect(quote.priced).toBe(false);
    expect(quote.priceUsd).not.toBe(1_000);
  });
});

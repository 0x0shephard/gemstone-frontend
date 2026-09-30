import { describe, expect, it } from 'vitest';
import {
  directSwapOwner,
  purchaseQuote,
  reserveShortfallUsd,
  shortfallLabel,
  swapReserveEligible,
  swapUnavailableReason,
  inGiftEscrow,
  gemLocation,
} from './gem';
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

describe('swapReserveEligible', () => {
  it('allows any positive reserve and blocks only an empty one', () => {
    expect(swapReserveEligible({ reserve: 100, reserveBalanceUsd: 1_000n * 10n ** 18n })).toBe(
      true,
    );
    expect(swapReserveEligible({ reserve: 10, reserveBalanceUsd: 100n * 10n ** 18n })).toBe(true);
    // Rounds to 0% in the UI but is a positive balance on chain.
    expect(swapReserveEligible({ reserve: 0, reserveBalanceUsd: 1n })).toBe(true);
    expect(swapReserveEligible({ reserve: 0, reserveBalanceUsd: 0n })).toBe(false);
  });

  it('passes a gem with no reserve requirement, as the contract does', () => {
    expect(swapReserveEligible({ reserve: 100, reserveBalanceUsd: 0n })).toBe(true);
  });
});

describe('directSwapOwner', () => {
  const viewer = '0x0000000000000000000000000000000000000001';
  const other = '0x0000000000000000000000000000000000000002';
  const escrow = '0x0000000000000000000000000000000000000003';

  it('distinguishes a directly owned offered token from another wallet target', () => {
    expect(directSwapOwner({ tokenId: 1n, owner: viewer }, viewer)).toBe('viewer');
    expect(directSwapOwner({ tokenId: 2n, owner: other }, viewer)).toBe('other');
  });

  it('excludes listings and every configured custody address', () => {
    expect(
      directSwapOwner({ tokenId: 1n, owner: other, listingSeller: viewer }, viewer),
    ).toBeUndefined();
    expect(directSwapOwner({ tokenId: 1n, owner: escrow }, viewer, [escrow])).toBeUndefined();
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

describe('swapUnavailableReason', () => {
  const viewer = '0x00000000000000000000000000000000000000aa' as const;
  const custody = {
    marketplace: '0x00000000000000000000000000000000000000b1' as const,
    swapEscrow: '0x00000000000000000000000000000000000000b2' as const,
    giftOperator: '0x00000000000000000000000000000000000000b3' as const,
  };
  const gem = (over: Record<string, unknown> = {}) =>
    ({ tokenId: 7n, owner: viewer, reserve: 40, reserveBalanceUsd: 1n, ...over }) as never;
  const none = new Set<string>();

  it('allows a directly held, unlocked token with any positive reserve', () => {
    expect(swapUnavailableReason(gem(), viewer, custody, none)).toBeUndefined();
  });

  it('names every reason a held token cannot be offered', () => {
    expect(swapUnavailableReason(gem({ listingSeller: viewer }), viewer, custody, none)).toMatch(
      /listed/,
    );
    expect(
      swapUnavailableReason(gem({ owner: custody.swapEscrow }), viewer, custody, none),
    ).toMatch(/another swap/);
    expect(
      swapUnavailableReason(
        gem({ owner: custody.giftOperator, escrowDepositor: viewer }),
        viewer,
        custody,
        none,
      ),
    ).toMatch(/gift card/);
    expect(swapUnavailableReason(gem(), viewer, custody, new Set(['7']))).toMatch(/redemption/);
    expect(
      swapUnavailableReason(gem({ reserve: 0, reserveBalanceUsd: 0n }), viewer, custody, none),
    ).toMatch(/reserve is empty/);
  });
});

describe('gift escrow held by an operator that is also a real wallet', () => {
  const operator = '0x00000000000000000000000000000000000000b3' as const;
  const client = '0x00000000000000000000000000000000000000c1' as const;
  const custody = {
    marketplace: '0x00000000000000000000000000000000000000b1' as const,
    swapEscrow: '0x00000000000000000000000000000000000000b2' as const,
    giftOperator: operator,
  };
  const held = (escrowDepositor?: `0x${string}`) =>
    ({
      tokenId: 17n,
      owner: operator,
      escrowDepositor,
      reserve: 40,
      reserveBalanceUsd: 1n,
    }) as never;

  it("treats the operator's own tokens as its own, not as gifts", () => {
    expect(inGiftEscrow(held(operator), operator)).toBe(false);
    expect(inGiftEscrow(held(), operator)).toBe(false);
    expect(swapUnavailableReason(held(operator), operator, custody, new Set())).toBeUndefined();
    expect(
      directSwapOwner(
        held(operator),
        operator,
        [custody.marketplace, custody.swapEscrow],
        operator,
      ),
    ).toBe('viewer');
  });

  it("keeps a token deposited by someone else's gift in escrow", () => {
    expect(inGiftEscrow(held(client), operator)).toBe(true);
    expect(swapUnavailableReason(held(client), operator, custody, new Set())).toMatch(/gift card/);
    expect(
      directSwapOwner(held(client), client, [custody.marketplace, custody.swapEscrow], operator),
    ).toBeUndefined();
  });
});

describe('gemLocation', () => {
  const viewer = '0x00000000000000000000000000000000000000aa' as const;
  const custody = {
    marketplace: '0x00000000000000000000000000000000000000b1' as const,
    swapEscrow: '0x00000000000000000000000000000000000000b2' as const,
    giftOperator: '0x00000000000000000000000000000000000000b3' as const,
  };
  const at = (over: Record<string, unknown>) =>
    gemLocation({ tokenId: 1n, owner: viewer, ...over } as never, viewer, custody).label;

  it('says where each gem is right now', () => {
    expect(at({ tokenId: undefined })).toBe('Primary auction');
    expect(at({ transferLocked: true })).toBe('Redemption in progress');
    expect(at({ listingSeller: viewer })).toBe('Listed for sale');
    expect(at({ listingSeller: viewer, listingWinningOfferId: 3n })).toBe('Auction in progress');
    expect(at({ owner: custody.swapEscrow })).toBe('Offered in a swap');
    expect(at({ owner: custody.giftOperator, escrowDepositor: viewer })).toBe(
      'In gift-card escrow',
    );
    expect(at({})).toBe('In your wallet');
    expect(at({ owner: '0x00000000000000000000000000000000000000dd' })).toBe(
      "In a collector's wallet",
    );
  });
});

describe('gift escrow from the open-gift lookup', () => {
  const operator = '0x00000000000000000000000000000000000000b3' as const;
  const client = '0x00000000000000000000000000000000000000c1' as const;

  it('trusts the database over a stale deposit record after a self-transfer', () => {
    // DGE-14: the client's gift was cancelled back into the escrow wallet itself,
    // so DGENFT still names the client as depositor.
    const cancelled = { owner: operator, escrowDepositor: client, giftEscrowed: false };
    const open = { owner: operator, escrowDepositor: client, giftEscrowed: true };
    expect(inGiftEscrow(cancelled as never, operator)).toBe(false);
    expect(inGiftEscrow(open as never, operator)).toBe(true);
  });
});

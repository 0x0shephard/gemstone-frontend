import { describe, expect, it } from 'vitest';
import { listingBidReleased, minimumBidUsd, primaryBidWithdrawable } from './auctionBid';

const usd = (value: number) => BigInt(value) * 10n ** 18n;

describe('minimum auction bid', () => {
  it('is the floor while nobody leads', () => {
    expect(minimumBidUsd({ floorUsd: usd(4_968) })).toBe(usd(4_968));
  });

  it('is the leading bid plus one dollar once someone leads', () => {
    expect(
      minimumBidUsd({
        floorUsd: usd(4_968),
        highestBidder: '0x5f8DB7637281C6D614ea4344d21752d5BA96d3E2',
        highestBidUsd: usd(6_000),
      }),
    ).toBe(usd(6_001));
  });
});

describe('primary bid withdrawal', () => {
  const viewer = '0x5f8DB7637281C6D614ea4344d21752d5BA96d3E2';
  const WEEK = 7 * 24 * 60 * 60;
  const binding = { binding: true, settlementGraceSeconds: WEEK };
  const endTime = 1_800_000_000n;
  const leading = { settled: false, endTime, highestBidder: viewer.toLowerCase() as `0x${string}` };

  it('is binding through the close and the settlement grace period', () => {
    expect(primaryBidWithdrawable(leading, viewer, binding, endTime - 1n)).toBe(false);
    expect(primaryBidWithdrawable(leading, viewer, binding, endTime + BigInt(WEEK) - 1n)).toBe(
      false,
    );
  });

  it('opens once the grace period has passed with nobody settling', () => {
    expect(primaryBidWithdrawable(leading, viewer, binding, endTime + BigInt(WEEK))).toBe(true);
  });

  it('opens at any time while the contract is paused', () => {
    expect(
      primaryBidWithdrawable(leading, viewer, { ...binding, paused: true }, endTime - 3_600n),
    ).toBe(true);
  });

  it('is never offered to someone else, on a settled auction, or before the policy is read', () => {
    const late = endTime + BigInt(WEEK) + 1n;
    expect(
      primaryBidWithdrawable(leading, '0x1111111111111111111111111111111111111111', binding, late),
    ).toBe(false);
    expect(primaryBidWithdrawable({ ...leading, settled: true }, viewer, binding, late)).toBe(
      false,
    );
    expect(primaryBidWithdrawable(leading, viewer, undefined, late)).toBe(false);
  });

  it('keeps the pre-binding rule on older contracts: withdrawable until the close', () => {
    const legacy = { binding: false, settlementGraceSeconds: 0 };
    expect(primaryBidWithdrawable(leading, viewer, legacy, endTime - 1n)).toBe(true);
    expect(primaryBidWithdrawable(leading, viewer, legacy, endTime)).toBe(false);
  });
});

describe('listing bid release', () => {
  const WEEK = 7 * 24 * 60 * 60;
  const binding = { binding: true, settlementGraceSeconds: WEEK };
  const offer = { automatic: true, expiry: 1_800_000_000n };

  it('releases a binding listing bid while paused or once the grace period has passed', () => {
    expect(listingBidReleased(offer, binding, offer.expiry - 60n)).toBe(false);
    expect(listingBidReleased(offer, { ...binding, paused: true }, offer.expiry - 60n)).toBe(true);
    expect(listingBidReleased(offer, binding, offer.expiry + BigInt(WEEK))).toBe(true);
    expect(listingBidReleased({ ...offer, automatic: false }, binding, offer.expiry + 1n)).toBe(
      false,
    );
  });
});

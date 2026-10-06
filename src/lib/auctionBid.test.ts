import { describe, expect, it } from 'vitest';
import { minimumBidUsd } from './auctionBid';

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

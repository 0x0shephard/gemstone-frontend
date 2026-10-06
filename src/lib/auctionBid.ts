import type { Auction } from '@/services/types';

/** Mirrors `PrimarySaleAuction.MIN_BID_INCREMENT_USD`. */
export const MIN_BID_INCREMENT_USD = 10n ** 18n;

/**
 * The lowest sale amount (18-decimal USD, before the reserve top-up) the
 * contract accepts as the next bid: the floor while nobody leads, otherwise the
 * leading bid plus the minimum increment.
 */
export function minimumBidUsd(
  auction: Pick<Auction, 'floorUsd' | 'highestBidder' | 'highestBidUsd'>,
): bigint {
  if (!auction.highestBidder || !auction.highestBidUsd) return auction.floorUsd;
  const next = auction.highestBidUsd + MIN_BID_INCREMENT_USD;
  return next > auction.floorUsd ? next : auction.floorUsd;
}

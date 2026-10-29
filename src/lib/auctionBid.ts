import type { Address } from 'viem';
import type { Auction, BindingRule, Offer } from '@/services/types';

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

const nowSeconds = () => BigInt(Math.floor(Date.now() / 1_000));

/**
 * Whether the viewer can take their leading primary bid back right now.
 *
 * Binding contracts (`PrimarySaleAuction.cancelBid`) release the leader only
 * while the contract is paused, or once the auction is `SETTLEMENT_GRACE` past
 * its end without being settled. After that point the bid has no other exit:
 * settlement can refund it, but nobody is obliged to call it. Older contracts
 * allow withdrawal until the close. An unread policy offers nothing, because a
 * button that reverts is worse than none.
 */
export function primaryBidWithdrawable(
  auction: Pick<Auction, 'settled' | 'endTime' | 'highestBidder'>,
  viewer: Address | string | undefined,
  rule: BindingRule | undefined,
  now: bigint = nowSeconds(),
): boolean {
  if (!viewer || !auction.highestBidder || auction.settled || !rule) return false;
  if (auction.highestBidder.toLowerCase() !== viewer.toLowerCase()) return false;
  if (!rule.binding) return now < auction.endTime;
  if (rule.paused) return true;
  return now >= auction.endTime + BigInt(rule.settlementGraceSeconds);
}

/**
 * Whether a binding listing-auction bid has been released to its bidder:
 * the Marketplace is paused, or the auction is `SETTLEMENT_GRACE` past its end
 * unsettled (`Marketplace.cancelOffer`). Mirrors {@link primaryBidWithdrawable}.
 */
export function listingBidReleased(
  offer: Pick<Offer, 'automatic' | 'expiry'>,
  rule: BindingRule | undefined,
  now: bigint = nowSeconds(),
): boolean {
  if (!rule?.binding || !offer.automatic) return false;
  if (rule.paused) return true;
  return now >= offer.expiry + BigInt(rule.settlementGraceSeconds);
}

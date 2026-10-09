import type { Address } from 'viem';
import type { Offer } from '../types';

/**
 * The current winning bid on a minted token, as the marketplace shows it.
 *
 * - A listed token's bids form a 24-hour listing auction: the winner is the
 *   auction leader (`Marketplace.listingWinningOffer`), and the auction's bids
 *   are the ones sharing its end time.
 * - An unlisted token can hold several open offers at once; the winner is the
 *   highest one, though the owner still chooses which to accept.
 *
 * `bidders` counts each account once and leaves out bids their bidder
 * withdrew, matching the primary auction's bid count.
 */
export interface BidSummary {
  kind: 'listing-auction' | 'offers';
  winning: { offerId: bigint; bidder: Address; saleUsd: bigint; offerFmt: string };
  bidders: number;
  /** Listing auctions only: seconds until it settles. */
  secondsLeft?: number;
}

export function bidSummaries(offers: readonly Offer[]): Map<string, BidSummary> {
  const byToken = new Map<string, Offer[]>();
  for (const offer of offers) {
    const tokenId = offer.gem.tokenId?.toString();
    if (!tokenId) continue;
    byToken.set(tokenId, [...(byToken.get(tokenId) ?? []), offer]);
  }
  const summaries = new Map<string, BidSummary>();
  for (const [tokenId, tokenOffers] of byToken) {
    const leader = tokenOffers.find(
      (offer) =>
        offer.automatic && (offer.status === 'Pending' || offer.status === 'Awaiting settlement'),
    );
    if (leader) {
      const auctionBids = tokenOffers.filter(
        (offer) => offer.expiry === leader.expiry && !offer.withdrawn,
      );
      summaries.set(tokenId, {
        kind: 'listing-auction',
        winning: winningOf(leader),
        bidders: distinctBidders(auctionBids),
        secondsLeft: leader.secondsLeft,
      });
      continue;
    }
    const open = tokenOffers.filter((offer) => offer.status === 'Pending' && !offer.automatic);
    if (open.length === 0) continue;
    const top = open.reduce((best, offer) => (offer.saleUsd > best.saleUsd ? offer : best));
    summaries.set(tokenId, {
      kind: 'offers',
      winning: winningOf(top),
      bidders: distinctBidders(open),
    });
  }
  return summaries;
}

function winningOf(offer: Offer): BidSummary['winning'] {
  return {
    offerId: offer.offerId,
    bidder: offer.bidder,
    saleUsd: offer.saleUsd,
    offerFmt: offer.offerFmt,
  };
}

function distinctBidders(offers: readonly Offer[]): number {
  return new Set(offers.map((offer) => offer.bidder.toLowerCase())).size;
}

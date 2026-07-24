import type { ProjectedEvent } from './projection';

export interface DiscoveryState {
  gemIds: bigint[];
  activeListings: Map<bigint, bigint>;
  activeMarketplaceOffers: Set<bigint>;
  activeSwapOffers: Set<bigint>;
}

export function reduceDiscovery(events: ProjectedEvent[]): DiscoveryState {
  const gems = new Set<string>();
  const listings = new Map<bigint, bigint>();
  const marketplaceOffers = new Set<bigint>();
  const swaps = new Set<bigint>();
  const ordered = [...new Map(events.map((event) => [event.id, event])).values()].sort(
    (left, right) => Number(left.blockNumber - right.blockNumber) || left.logIndex - right.logIndex,
  );
  for (const event of ordered) {
    const id = (key: string) =>
      typeof event.args[key] === 'bigint' ? (event.args[key] as bigint) : undefined;
    if (event.eventName === 'GemRegistered' && id('gemId') !== undefined) {
      gems.add(String(id('gemId')));
    }
    if (event.module === 'Marketplace') {
      const tokenId = id('tokenId');
      const offerId = id('offerId');
      if (event.eventName === 'Listed' && tokenId !== undefined) {
        listings.set(tokenId, (event.args.priceUsd as bigint) ?? 0n);
      }
      if (
        (event.eventName === 'ListingCancelled' || event.eventName === 'Purchased') &&
        tokenId !== undefined
      )
        listings.delete(tokenId);
      if (event.eventName === 'OfferCreated' && offerId !== undefined)
        marketplaceOffers.add(offerId);
      if (
        (event.eventName === 'OfferAccepted' || event.eventName === 'OfferCancelled') &&
        offerId !== undefined
      )
        marketplaceOffers.delete(offerId);
    }
    if (event.module === 'SwapEscrow') {
      const offerId = id('offerId');
      if (event.eventName === 'OfferCreated' && offerId !== undefined) swaps.add(offerId);
      if (
        (event.eventName === 'OfferAccepted' || event.eventName === 'OfferCancelled') &&
        offerId !== undefined
      )
        swaps.delete(offerId);
    }
  }
  return {
    gemIds: [...gems].map(BigInt),
    activeListings: listings,
    activeMarketplaceOffers: marketplaceOffers,
    activeSwapOffers: swaps,
  };
}

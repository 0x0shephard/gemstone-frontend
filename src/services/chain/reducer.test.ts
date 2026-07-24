import { describe, expect, it } from 'vitest';
import type { ProjectedEvent } from './projection';
import { reduceDiscovery } from './reducer';

const event = (
  id: string,
  blockNumber: bigint,
  module: ProjectedEvent['module'],
  eventName: string,
  args: Record<string, unknown>,
): ProjectedEvent => ({
  id,
  blockNumber,
  module,
  eventName,
  args,
  transactionHash: `0x${'0'.repeat(64)}`,
  logIndex: 0,
  finalized: true,
});

describe('event projection reducers', () => {
  it('keeps identifiers in their own domains and applies lifecycle events in order', () => {
    const result = reduceDiscovery([
      event('gem', 1n, 'GemRegistry', 'GemRegistered', { gemId: 7n }),
      event('list', 2n, 'Marketplace', 'Listed', { tokenId: 41n, priceUsd: 5n }),
      event('offer', 3n, 'Marketplace', 'OfferCreated', { offerId: 41n }),
      event('swap', 4n, 'SwapEscrow', 'OfferCreated', { offerId: 41n }),
      event('sold', 5n, 'Marketplace', 'Purchased', { tokenId: 41n }),
      event('accepted', 6n, 'Marketplace', 'OfferAccepted', { offerId: 41n }),
    ]);
    expect(result.gemIds).toEqual([7n]);
    expect(result.activeListings.size).toBe(0);
    expect(result.activeMarketplaceOffers.size).toBe(0);
    expect(result.activeSwapOffers.has(41n)).toBe(true);
  });

  it('deduplicates a rescanned log by stable event id', () => {
    const log = event('same-log', 10n, 'Marketplace', 'Listed', {
      tokenId: 2n,
      priceUsd: 100n,
    });
    expect(reduceDiscovery([log, log]).activeListings.size).toBe(1);
  });
});

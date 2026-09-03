import { describe, expect, it } from 'vitest';
import type { ProjectedEvent } from './projection';
import {
  describePaymentAsset,
  escrowedSwapTokenIds,
  formatSwapCash,
  groupAuctions,
  groupActionableSwaps,
  latestBidEventsForAddress,
} from './marketPresentation';
import type { Auction, SwapRequest } from '../types';

const bidder = '0x1111111111111111111111111111111111111111';

function bidEvent(gemId: bigint, blockNumber: bigint, account = bidder): ProjectedEvent {
  return {
    id: `${blockNumber}`,
    module: 'PrimarySaleAuction',
    eventName: 'BidPlaced',
    args: { gemId, bidder: account, usdValue: 100n * 10n ** 18n },
    blockNumber,
    transactionHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
    logIndex: 0,
    finalized: true,
  };
}

describe('market presentation', () => {
  it('keeps the latest bid per gem for the connected account', () => {
    const latest = latestBidEventsForAddress(
      [
        bidEvent(1n, 1n),
        bidEvent(2n, 2n),
        bidEvent(1n, 3n),
        bidEvent(3n, 4n, '0x2222222222222222222222222222222222222222'),
      ],
      bidder,
    );
    expect(latest.map((event) => event.blockNumber)).toEqual([3n, 2n]);
  });

  it('formats six-decimal mock USDC swap adjustments', () => {
    const descriptor = describePaymentAsset(
      '0x29f4b1eF7261A372DB73493004CCf6A28175Dc54',
      '0x29f4b1eF7261A372DB73493004CCf6A28175Dc54',
    );
    expect(formatSwapCash(125_500_000n, 125_500_000_000_000_000_000n, descriptor, false)).toBe(
      'Accepter pays 125.5 mUSDC ($125.5)',
    );
  });

  it('keeps settled auctions as history instead of mixing them with open rounds', () => {
    const auctions = [
      { settled: false, secondsLeft: 60 },
      { settled: false, secondsLeft: 0 },
      { settled: true, secondsLeft: 0, outcome: 'Minted' },
    ] as Auction[];

    expect(groupAuctions(auctions)).toEqual({
      live: [auctions[0]],
      awaitingSettlement: [auctions[1]],
      past: [auctions[2]],
    });
  });

  it('separates open swaps from expired escrow that only the proposer can clear', () => {
    const proposer = '0x1111111111111111111111111111111111111111';
    const swaps = [
      { offerId: 1n, proposer, status: 'Active' },
      { offerId: 2n, proposer, status: 'Expired' },
      { offerId: 3n, proposer, status: 'Accepted' },
      { offerId: 4n, proposer, status: 'Cancelled' },
    ] as unknown as SwapRequest[];

    expect(groupActionableSwaps(swaps, proposer)).toEqual({
      active: [swaps[0]],
      expiredOwned: [swaps[1]],
    });
    expect(groupActionableSwaps(swaps, '0x2222222222222222222222222222222222222222')).toEqual({
      active: [swaps[0]],
      expiredOwned: [],
    });
  });

  it('keeps active and expired swap escrow in the proposer portfolio', () => {
    const proposer = '0x1111111111111111111111111111111111111111';
    const swaps = [
      { offeredTokenId: 19n, proposer, status: 'Expired' },
      { offeredTokenId: 20n, proposer, status: 'Active' },
      { offeredTokenId: 21n, proposer, status: 'Accepted' },
      {
        offeredTokenId: 22n,
        proposer: '0x2222222222222222222222222222222222222222',
        status: 'Active',
      },
    ] as unknown as SwapRequest[];

    expect([...escrowedSwapTokenIds(swaps, proposer)]).toEqual(['19', '20']);
  });
});

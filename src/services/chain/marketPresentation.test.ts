import { describe, expect, it } from 'vitest';
import type { ProjectedEvent } from './projection';
import {
  describePaymentAsset,
  escrowedSwapTokenIds,
  formatSwapCash,
  groupAuctions,
  groupActionableSwaps,
  latestBidEventsForAddress,
  auctionBidCount,
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

  it('counts each bidder once and skips bidders who withdrew', () => {
    const other = '0x2222222222222222222222222222222222222222';
    const events = [
      bidEvent(5n, 1n),
      bidEvent(5n, 2n, other),
      { ...bidEvent(5n, 3n, other), eventName: 'BidCancelled' },
      bidEvent(5n, 4n),
      bidEvent(6n, 5n),
    ];
    // The default bidder bid twice; the other bidder cancelled.
    expect(auctionBidCount(events, 5n)).toBe(1);
  });

  it('drops a bid the account cancelled, unless it bid again afterwards', () => {
    const cancelled = (gemId: bigint, blockNumber: bigint) => ({
      ...bidEvent(gemId, blockNumber),
      eventName: 'BidCancelled',
    });
    const latest = latestBidEventsForAddress(
      [bidEvent(1n, 1n), cancelled(1n, 2n), bidEvent(2n, 3n), cancelled(2n, 4n), bidEvent(2n, 5n)],
      bidder,
    );
    expect(latest.map((event) => event.blockNumber)).toEqual([5n]);
  });

  it('formats six-decimal mock USDC swap adjustments', () => {
    const address = '0x29f4b1eF7261A372DB73493004CCf6A28175Dc54';
    const descriptor = describePaymentAsset(address, [
      {
        address,
        symbol: 'mUSDC',
        name: 'Mock USDC',
        decimals: 6,
        isNative: false,
        enabled: true,
        usdPrice: 1,
      },
    ]);
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
      { offerId: 1n, proposer, status: 'Active', gem: {} },
      { offerId: 2n, proposer, status: 'Expired', gem: {} },
      { offerId: 3n, proposer, status: 'Accepted', gem: {} },
      { offerId: 4n, proposer, status: 'Cancelled', gem: {} },
    ] as unknown as SwapRequest[];

    expect(groupActionableSwaps(swaps, proposer)).toEqual({
      active: [swaps[0]],
      expiredOwned: [swaps[1]],
      blockedOwned: [],
    });
    expect(groupActionableSwaps(swaps, '0x2222222222222222222222222222222222222222')).toEqual({
      active: [swaps[0]],
      expiredOwned: [],
      blockedOwned: [],
    });
  });

  it('takes swaps for a gemstone in redemption off the open board', () => {
    const proposer = '0x1111111111111111111111111111111111111111';
    const swaps = [
      { offerId: 1n, proposer, status: 'Active', gem: { transferLocked: true } },
      { offerId: 2n, proposer, status: 'Active', gem: { transferLocked: false } },
    ] as unknown as SwapRequest[];

    expect(groupActionableSwaps(swaps, proposer)).toEqual({
      active: [swaps[1]],
      expiredOwned: [],
      blockedOwned: [swaps[0]],
    });
    expect(groupActionableSwaps(swaps, '0x2222222222222222222222222222222222222222')).toEqual({
      active: [swaps[1]],
      expiredOwned: [],
      blockedOwned: [],
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

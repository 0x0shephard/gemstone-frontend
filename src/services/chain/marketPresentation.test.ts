import { describe, expect, it } from 'vitest';
import type { ProjectedEvent } from './projection';
import {
  describePaymentAsset,
  formatSwapCash,
  latestBidEventsForAddress,
} from './marketPresentation';

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
});

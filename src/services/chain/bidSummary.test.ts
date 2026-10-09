import { describe, expect, it } from 'vitest';
import type { Offer } from '../types';
import { bidSummaries } from './bidSummary';

const usd = (value: number) => BigInt(value) * 10n ** 18n;
const alice = '0x1111111111111111111111111111111111111111';
const bob = '0x2222222222222222222222222222222222222222';
const carol = '0x3333333333333333333333333333333333333333';

function offer(partial: Partial<Offer> & { offerId: bigint; tokenId: bigint }): Offer {
  return {
    gem: { tokenId: partial.tokenId },
    bidder: alice,
    tokenOwner: carol,
    offerFmt: '$0',
    from: alice,
    automatic: false,
    status: 'Pending',
    statusColor: '',
    secondsLeft: 3_600,
    saleUsd: usd(0),
    expiry: 100n,
    withdrawn: false,
    ...partial,
  } as unknown as Offer;
}

describe('bidSummaries', () => {
  it('uses the listing auction leader and counts its bidders once each', () => {
    const summaries = bidSummaries([
      offer({ offerId: 1n, tokenId: 7n, bidder: alice, saleUsd: usd(1_100), status: 'Refunded' }),
      offer({ offerId: 2n, tokenId: 7n, bidder: bob, saleUsd: usd(1_200), status: 'Refunded' }),
      offer({
        offerId: 3n,
        tokenId: 7n,
        bidder: alice,
        saleUsd: usd(1_300),
        automatic: true,
        offerFmt: '$1,300',
      }),
      // A bid in an earlier auction on the same token does not count.
      offer({ offerId: 4n, tokenId: 7n, bidder: carol, expiry: 50n, status: 'Refunded' }),
    ]);
    expect(summaries.get('7')).toMatchObject({
      kind: 'listing-auction',
      winning: { offerId: 3n, bidder: alice, offerFmt: '$1,300' },
      bidders: 2,
      secondsLeft: 3_600,
    });
  });

  it('leaves withdrawn bids out of the count', () => {
    const summaries = bidSummaries([
      offer({ offerId: 1n, tokenId: 7n, bidder: bob, status: 'Refunded', withdrawn: true }),
      offer({ offerId: 2n, tokenId: 7n, bidder: alice, automatic: true }),
    ]);
    expect(summaries.get('7')?.bidders).toBe(1);
  });

  it('takes the highest open offer on an unlisted token', () => {
    const summaries = bidSummaries([
      offer({ offerId: 1n, tokenId: 9n, bidder: alice, saleUsd: usd(500) }),
      offer({ offerId: 2n, tokenId: 9n, bidder: bob, saleUsd: usd(900), offerFmt: '$900' }),
      offer({ offerId: 3n, tokenId: 9n, bidder: carol, saleUsd: usd(2_000), status: 'Expired' }),
    ]);
    expect(summaries.get('9')).toMatchObject({
      kind: 'offers',
      winning: { offerId: 2n, bidder: bob, offerFmt: '$900' },
      bidders: 2,
    });
  });

  it('has nothing to show for a token without live bids', () => {
    expect(bidSummaries([offer({ offerId: 1n, tokenId: 9n, status: 'Accepted' })]).size).toBe(0);
  });
});

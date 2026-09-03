import type { IDataService, ProfileData, LandingData } from './IDataService';
import type { DecoratedGem, Auction, Bid, Offer, SwapRequest, Redemption, TxResult } from './types';
import { zeroAddress, type Address } from 'viem';
import { decorate, reserveShortfallUsd } from '@/lib/gem';
import {
  gems,
  ownedGemIds,
  auctionSeeds,
  bidSeeds,
  offerSeeds,
  swapSeeds,
  redemptionSeeds,
  activity,
  feeTiers,
  treasurySplit,
  trustSignals,
  howSteps,
  paymentAssets,
  protocolStats,
} from './mockData';

const LATENCY = 260;
const delay = <T>(value: T, ms = LATENCY): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

function randomHash(): `0x${string}` {
  const hex = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(
    '',
  );
  return `0x${hex}`;
}
const ok = (): Promise<TxResult> => delay({ hash: randomHash(), status: 'success' as const }, 700);

const decoratedGems = (): DecoratedGem[] => gems.map(decorate);
const byId = (gemId: bigint): DecoratedGem | undefined => {
  const g = gems.find((x) => x.gemId === gemId);
  return g ? decorate(g) : undefined;
};
const dgById = (gemId: bigint): DecoratedGem => byId(gemId) ?? decorate(gems[0]);

function buildAuctions(): Auction[] {
  return auctionSeeds.map(([gemId, bid, count, secondsLeft]) => {
    const gem = dgById(gemId);
    return {
      gem,
      highestBidFmt: '$' + bid.toLocaleString('en-US'),
      bids: count,
      secondsLeft,
      floorUsd: BigInt(Math.round(gem.value * 0.85)) * 10n ** 18n,
      settled: false,
    };
  });
}

function buildBids(): Bid[] {
  return bidSeeds.map(([gemId, my, top, status, secondsLeft]) => ({
    gem: dgById(gemId),
    myBidFmt: '$' + my.toLocaleString('en-US'),
    topBidFmt: '$' + top.toLocaleString('en-US'),
    status,
    statusColor: status === 'Leading' ? 'var(--dc-emerald)' : 'var(--dc-ruby)',
    secondsLeft,
  }));
}

function buildOffers(): Offer[] {
  return offerSeeds.map(([offerId, gemId, amount, from, status, secondsLeft]) => ({
    offerId,
    gem: dgById(gemId),
    bidder: from as Address,
    tokenOwner: zeroAddress,
    listingSeller: undefined,
    offerFmt: '$' + amount.toLocaleString('en-US'),
    from,
    status,
    statusColor:
      status === 'Pending'
        ? 'var(--dc-amber)'
        : status === 'Accepted'
          ? 'var(--dc-emerald)'
          : '#8B8B94',
    secondsLeft,
  }));
}

function buildSwaps(): SwapRequest[] {
  return swapSeeds.map(([offerId, gemId, giveId, diff, status]) => {
    const give = dgById(giveId);
    const requested = dgById(gemId);
    return {
      offerId,
      gem: requested,
      proposer: zeroAddress,
      requestedOwner: zeroAddress,
      offeredTokenId: give.tokenId!,
      requestedTokenId: requested.tokenId!,
      giveName: give.name,
      giveDisplayId: give.displayId,
      diff,
      status,
      statusColor: 'var(--dc-amber)',
    };
  });
}

function buildRedemptions(): Redemption[] {
  return redemptionSeeds.map(([workflowId, gemId, stage, progress, status]) => ({
    workflowId,
    tokenId: dgById(gemId).tokenId!,
    gem: dgById(gemId),
    owner: zeroAddress,
    custodian: zeroAddress,
    stage,
    progress,
    status,
    statusColor: 'var(--dc-amber)',
  }));
}

export const mockService: IDataService = {
  getGems: () => delay(decoratedGems()),
  getGem: (id) => delay(byId(id)),
  getListings: () => delay(decoratedGems()),
  getAuctions: () => delay(buildAuctions()),
  getAuction: (gemId) => delay(buildAuctions().find((a) => a.gem.gemId === gemId)),
  getOffers: () => delay(buildOffers()),
  getSwapRequests: () => delay(buildSwaps()),
  getRedemptions: () => delay(buildRedemptions()),

  getProfile: () => {
    const owned = ownedGemIds.map(dgById);
    const bids = buildBids();
    const data: ProfileData = {
      owned,
      bids,
      offers: buildOffers(),
      swaps: buildSwaps(),
      redemptions: buildRedemptions(),
      activity,
      stats: {
        portfolioValueUsd: owned.reduce((s, g) => s + g.value, 0),
        ownedCount: owned.length,
        activeBids: bids.length,
        reserveShortfallUsd: owned.reduce((s, g) => s + reserveShortfallUsd(g), 0),
      },
    };
    return delay(data);
  },

  getLanding: () => {
    const data: LandingData = {
      featured: decoratedGems().slice(0, 3),
      auctions: buildAuctions(),
      trustSignals,
      howSteps,
      treasurySplit,
      gemsInVault: protocolStats.gemsInVault,
      featuredCaption: protocolStats.featuredCaption,
    };
    return delay(data);
  },

  getFeeTiers: () => delay(feeTiers),
  getPaymentAssets: () => delay(paymentAssets),
  getPendingAuctionRefunds: () =>
    delay([
      {
        paymentAsset: paymentAssets[0].address,
        symbol: paymentAssets[0].symbol,
        amount: 125000000000000000n,
        amountFmt: '0.125 ETH',
      },
    ]),
  getPendingTreasuryPayout: () =>
    delay({
      amount: 400000000000000000n,
      amountFmt: '0.4 ETH',
    }),
  getTokenApprovals: (tokenIds: bigint[]) =>
    delay(Object.fromEntries(tokenIds.map((tokenId) => [tokenId.toString(), zeroAddress]))),

  // writes — resolve a mock tx hash after simulated confirmation latency
  buyNow: ok,
  buy: ok,
  list: ok,
  cancelListing: ok,
  transferToken: ok,
  approveTransfer: ok,
  revokeApproval: ok,
  bid: ok,
  settleAuction: ok,
  claimRefund: ok,
  claimTreasuryPayout: ok,
  createOffer: ok,
  acceptOffer: ok,
  refundExpiredOffer: ok,
  createSwap: ok,
  acceptSwap: ok,
  cancelSwap: ok,
  requestRedemption: ok,
  cancelRedemption: ok,
  confirmRedemption: ok,
  fundReserve: ok,
};

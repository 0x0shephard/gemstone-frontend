import type { IDataService, ProfileData, LandingData } from './IDataService';
import type {
  DecoratedGem,
  Auction,
  Bid,
  Offer,
  SwapRequest,
  Redemption,
  TxResult,
} from './types';
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
  const hex = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `0x${hex}`;
}
const ok = (): Promise<TxResult> => delay({ hash: randomHash(), status: 'success' as const }, 700);

const decoratedGems = (): DecoratedGem[] => gems.map(decorate);
const byId = (id: string): DecoratedGem | undefined => {
  const g = gems.find((x) => x.id === id);
  return g ? decorate(g) : undefined;
};
const dgById = (id: string): DecoratedGem => byId(id) ?? decorate(gems[0]);

function buildAuctions(): Auction[] {
  return auctionSeeds.map(([gemId, bid, count, secondsLeft]) => {
    const gem = dgById(gemId);
    return {
      gem,
      highestBidFmt: '$' + bid.toLocaleString('en-US'),
      bids: count,
      secondsLeft,
      floorUsd: Math.round(gem.value * 0.85),
    };
  });
}

function buildBids(): Bid[] {
  return bidSeeds.map(([gemId, my, top, status, secondsLeft]) => ({
    gem: dgById(gemId),
    myBidFmt: '$' + my.toLocaleString('en-US'),
    topBidFmt: '$' + top.toLocaleString('en-US'),
    status,
    statusColor: status === 'Leading' ? '#35B98A' : '#E5484D',
    secondsLeft,
  }));
}

function buildOffers(): Offer[] {
  return offerSeeds.map(([gemId, amount, from, status, secondsLeft]) => ({
    gem: dgById(gemId),
    offerFmt: '$' + amount.toLocaleString('en-US'),
    from,
    status,
    statusColor: status === 'Pending' ? '#E5A23C' : status === 'Accepted' ? '#35B98A' : '#8B8B94',
    secondsLeft,
  }));
}

function buildSwaps(): SwapRequest[] {
  return swapSeeds.map(([gemId, giveId, diff, status]) => {
    const give = dgById(giveId);
    return {
      gem: dgById(gemId),
      giveName: give.name,
      giveId: give.gemId,
      diff,
      status,
      statusColor: '#E5A23C',
    };
  });
}

function buildRedemptions(): Redemption[] {
  return redemptionSeeds.map(([gemId, stage, progress, status]) => ({
    gem: dgById(gemId),
    stage,
    progress,
    status,
    statusColor: '#E5A23C',
  }));
}

export const mockService: IDataService = {
  getGems: () => delay(decoratedGems()),
  getGem: (id) => delay(byId(id)),
  getListings: () => delay(decoratedGems()),
  getAuctions: () => delay(buildAuctions()),
  getAuction: (gemId) => delay(buildAuctions().find((a) => a.gem.id === gemId)),
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

  // writes — resolve a mock tx hash after simulated confirmation latency
  buyNow: ok,
  buy: ok,
  list: ok,
  cancelListing: ok,
  bid: ok,
  settleAuction: ok,
  claimRefund: ok,
  createOffer: ok,
  acceptOffer: ok,
  createSwap: ok,
  acceptSwap: ok,
  requestRedemption: ok,
  cancelRedemption: ok,
  fundReserve: ok,
};

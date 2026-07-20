import type {
  DecoratedGem,
  Auction,
  Bid,
  Offer,
  SwapRequest,
  Redemption,
  ActivityItem,
  FeeTier,
  TreasurySplitItem,
  TrustSignal,
  HowStep,
  PaymentAsset,
  TxResult,
} from './types';

/** Aggregate returned for the Profile/Portfolio page. */
export interface ProfileData {
  owned: DecoratedGem[];
  bids: Bid[];
  offers: Offer[];
  swaps: SwapRequest[];
  redemptions: Redemption[];
  activity: ActivityItem[];
  stats: {
    portfolioValueUsd: number;
    ownedCount: number;
    activeBids: number;
    reserveShortfallUsd: number;
  };
}

/** Landing-page content bundle. */
export interface LandingData {
  featured: DecoratedGem[];
  auctions: Auction[];
  trustSignals: TrustSignal[];
  howSteps: HowStep[];
  treasurySplit: TreasurySplitItem[];
  gemsInVault: number;
  featuredCaption: string;
}

/**
 * The single interface every page/hook depends on. The mock implementation
 * serves fixtures today; a wagmi-backed implementation will satisfy the same
 * contract against real ABIs later — with no page changes.
 */
export interface IDataService {
  // reads
  getGems(): Promise<DecoratedGem[]>;
  getGem(id: string): Promise<DecoratedGem | undefined>;
  getListings(): Promise<DecoratedGem[]>;
  getAuctions(): Promise<Auction[]>;
  getAuction(gemId: string): Promise<Auction | undefined>;
  getOffers(): Promise<Offer[]>;
  getSwapRequests(): Promise<SwapRequest[]>;
  getRedemptions(): Promise<Redemption[]>;
  getProfile(address?: string): Promise<ProfileData>;
  getLanding(): Promise<LandingData>;
  getFeeTiers(): Promise<FeeTier[]>;
  getPaymentAssets(): Promise<PaymentAsset[]>;

  // writes (mocked tx today)
  buyNow(gemId: string, asset: string): Promise<TxResult>;
  buy(gemId: string, asset: string): Promise<TxResult>;
  list(gemId: string, priceUsd: number): Promise<TxResult>;
  cancelListing(gemId: string): Promise<TxResult>;
  bid(gemId: string, asset: string, amountUsd: number): Promise<TxResult>;
  settleAuction(gemId: string): Promise<TxResult>;
  claimRefund(asset: string): Promise<TxResult>;
  createOffer(gemId: string, asset: string, amountUsd: number): Promise<TxResult>;
  acceptOffer(gemId: string): Promise<TxResult>;
  createSwap(offeredGemId: string, requestedGemId: string, cashDeltaUsd: number): Promise<TxResult>;
  acceptSwap(swapGemId: string): Promise<TxResult>;
  requestRedemption(gemId: string): Promise<TxResult>;
  cancelRedemption(gemId: string): Promise<TxResult>;
  fundReserve(gemId: string, asset: string): Promise<TxResult>;
}

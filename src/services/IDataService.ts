import type {
  ActivityItem,
  Auction,
  Bid,
  BuyListingRequest,
  BuyNowRequest,
  CancelListingRequest,
  CancelRedemptionRequest,
  ClaimRefundRequest,
  ClaimTreasuryPayoutRequest,
  CreateOfferRequest,
  CreateSwapRequest,
  DecoratedGem,
  FeeTier,
  FundReserveRequest,
  HowStep,
  ListRequest,
  Offer,
  OfferRequest,
  PaymentAsset,
  PendingRefund,
  PendingTreasuryPayout,
  Redemption,
  RedemptionRequest,
  SettleAuctionRequest,
  SwapRequest,
  SwapRequestAction,
  TreasurySplitItem,
  TrustSignal,
  TxResult,
  BidRequest,
} from './types';

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

export interface LandingData {
  featured: DecoratedGem[];
  auctions: Auction[];
  trustSignals: TrustSignal[];
  howSteps: HowStep[];
  treasurySplit: TreasurySplitItem[];
  gemsInVault: number;
  featuredCaption: string;
}

export interface IDataService {
  getGems(): Promise<DecoratedGem[]>;
  getGem(gemId: bigint): Promise<DecoratedGem | undefined>;
  getListings(): Promise<DecoratedGem[]>;
  getAuctions(): Promise<Auction[]>;
  getAuction(gemId: bigint): Promise<Auction | undefined>;
  getOffers(): Promise<Offer[]>;
  getSwapRequests(): Promise<SwapRequest[]>;
  getRedemptions(): Promise<Redemption[]>;
  getProfile(address?: string): Promise<ProfileData>;
  getLanding(): Promise<LandingData>;
  getFeeTiers(): Promise<FeeTier[]>;
  getPaymentAssets(): Promise<PaymentAsset[]>;
  getPendingAuctionRefunds(address?: string): Promise<PendingRefund[]>;
  getPendingTreasuryPayout(address?: string): Promise<PendingTreasuryPayout | undefined>;

  buyNow(request: BuyNowRequest): Promise<TxResult>;
  buy(request: BuyListingRequest): Promise<TxResult>;
  list(request: ListRequest): Promise<TxResult>;
  cancelListing(request: CancelListingRequest): Promise<TxResult>;
  bid(request: BidRequest): Promise<TxResult>;
  settleAuction(request: SettleAuctionRequest): Promise<TxResult>;
  claimRefund(request: ClaimRefundRequest): Promise<TxResult>;
  claimTreasuryPayout(request: ClaimTreasuryPayoutRequest): Promise<TxResult>;
  createOffer(request: CreateOfferRequest): Promise<TxResult>;
  acceptOffer(request: OfferRequest): Promise<TxResult>;
  refundExpiredOffer(request: OfferRequest): Promise<TxResult>;
  createSwap(request: CreateSwapRequest): Promise<TxResult>;
  acceptSwap(request: SwapRequestAction): Promise<TxResult>;
  cancelSwap(request: SwapRequestAction): Promise<TxResult>;
  requestRedemption(request: RedemptionRequest): Promise<TxResult>;
  cancelRedemption(request: CancelRedemptionRequest): Promise<TxResult>;
  fundReserve(request: FundReserveRequest): Promise<TxResult>;
}

import type { Address } from 'viem';
import type {
  ActivityItem,
  ApproveTransferRequest,
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
  RevokeApprovalRequest,
  SettleAuctionRequest,
  SwapRequest,
  SwapRequestAction,
  TreasurySplitItem,
  TransferTokenRequest,
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
  /**
   * Who, if anyone, may move each of these tokens on the owner's behalf.
   *
   * Keyed by token id as a string, and zero-address where nothing is approved.
   * A gift card leaves this set, and only the owner can clear it — so the only
   * way to tell them it is still outstanding is to read it.
   */
  getTokenApprovals(tokenIds: bigint[]): Promise<Record<string, Address>>;

  buyNow(request: BuyNowRequest): Promise<TxResult>;
  buy(request: BuyListingRequest): Promise<TxResult>;
  list(request: ListRequest): Promise<TxResult>;
  cancelListing(request: CancelListingRequest): Promise<TxResult>;
  transferToken(request: TransferTokenRequest): Promise<TxResult>;
  approveTransfer(request: ApproveTransferRequest): Promise<TxResult>;
  revokeApproval(request: RevokeApprovalRequest): Promise<TxResult>;
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

import type { Address, Hash } from 'viem';

export type GemType = string;
export type RedeemStatus = 'Eligible' | 'KYC required' | 'Blocked';

export interface Gem {
  gemId: bigint;
  tokenId?: bigint;
  displayId: string;
  name: string;
  type: GemType;
  typeLabel: string;
  valueUsd: bigint;
  value: number;
  carats: number;
  reserve: number;
  reserveBalanceUsd: bigint;
  reserveShortfallUsd: bigint;
  feeTier: string;
  feePct: number;
  custodyProvider: string;
  custodyCountry: string;
  redeem: RedeemStatus;
  metadataUri?: string;
}

export interface DecoratedGem extends Gem {
  color: string;
  valueFmt: string;
  caratsFmt: string;
  thumb: string;
  reserveLabel: string;
  reserveColor: string;
  funded: boolean;
  feeLabel: string;
  custodyLabel: string;
}

export interface Auction {
  gem: DecoratedGem;
  highestBidFmt: string;
  highestBidder?: Address;
  bids: number;
  secondsLeft: number;
  floorUsd: bigint;
}

export interface Bid {
  gem: DecoratedGem;
  myBidFmt: string;
  topBidFmt: string;
  status: 'Leading' | 'Outbid';
  statusColor: string;
  secondsLeft: number;
}

export interface Offer {
  offerId: bigint;
  gem: DecoratedGem;
  offerFmt: string;
  from: string;
  status: 'Pending' | 'Accepted' | 'Expired' | 'Refunded';
  statusColor: string;
  secondsLeft: number;
}

export interface SwapRequest {
  offerId: bigint;
  gem: DecoratedGem;
  offeredTokenId: bigint;
  requestedTokenId: bigint;
  giveName: string;
  giveDisplayId: string;
  diff: string;
  status: 'Active' | 'Accepted' | 'Cancelled' | 'Expired';
  statusColor: string;
}

export interface Redemption {
  workflowId: string;
  tokenId: bigint;
  gem: DecoratedGem;
  stage: string;
  progress: number;
  status: string;
  statusColor: string;
}

export interface ActivityItem {
  kind: string;
  gem: string;
  displayId: string;
  amount: string;
  date: string;
  color: string;
  txHash?: Hash;
}

export interface FeeTier {
  tier: string;
  range: string;
  pct: string;
}

export interface TreasurySplitItem {
  label: string;
  pct: string;
  color: string;
}

export interface TrustSignal {
  title: string;
  sub: string;
  color: string;
}

export interface HowStep {
  num: string;
  title: string;
  body: string;
}

export interface PaymentAsset {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  usdPrice: number;
  enabled: boolean;
  isNative: boolean;
}

export interface PendingRefund {
  paymentAsset: Address;
  symbol: PaymentAsset['symbol'];
  amount: bigint;
  amountFmt: string;
}

export interface PendingTreasuryPayout {
  amount: bigint;
  amountFmt: string;
}

export interface TxResult {
  hash: Hash;
  status: 'success';
}

export interface BuyNowRequest {
  gemId: bigint;
  paymentAsset: Address;
  maximumAmount?: bigint;
}

export interface BuyListingRequest {
  tokenId: bigint;
  paymentAsset: Address;
  maximumAmount?: bigint;
}

export interface ListRequest {
  tokenId: bigint;
  priceUsd: bigint;
}

export interface CancelListingRequest {
  tokenId: bigint;
}

export interface BidRequest {
  gemId: bigint;
  paymentAsset: Address;
  amountUsd: bigint;
}

export interface SettleAuctionRequest {
  gemId: bigint;
}

export interface ClaimRefundRequest {
  paymentAsset: Address;
}

export interface ClaimTreasuryPayoutRequest {
  recipient: Address;
}

export interface CreateOfferRequest {
  tokenId: bigint;
  paymentAsset: Address;
  amountUsd: bigint;
}

export interface OfferRequest {
  offerId: bigint;
}

export interface CreateSwapRequest {
  offeredTokenId: bigint;
  requestedTokenId: bigint;
  paymentAsset: Address;
  cashAmountUsd: bigint;
  proposerPays: boolean;
  expiresAt: bigint;
}

export interface SwapRequestAction {
  offerId: bigint;
}

export interface RedemptionRequest {
  tokenId: bigint;
  requestHash: Hash;
}

export interface CancelRedemptionRequest {
  tokenId: bigint;
}

export interface FundReserveRequest {
  gemId: bigint;
  paymentAsset: Address;
  amountUsd: bigint;
}

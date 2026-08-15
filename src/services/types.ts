import type { Address, Hash } from 'viem';

export type GemType = string;
/**
 * Redemption no longer turns on identity verification. `canRedeem` fails only
 * when an address is on the compliance block list, so `'KYC required'` was
 * removed rather than left unused — keeping it invited the old label back.
 */
export type RedeemStatus = 'Eligible' | 'Blocked';

export interface Gem {
  gemId: bigint;
  tokenId?: bigint;
  market?: 'primary' | 'secondary';
  /**
   * Current holder of the minted token. Absent until a stone is won at auction,
   * which is the only way a token comes into existence.
   */
  owner?: Address;
  /** Set only while the token is escrowed in an active Marketplace listing. */
  listingSeller?: Address;
  /**
   * What the owner is asking, when listed.
   *
   * Kept apart from `valueUsd`/`value`, which always carry the expert-approved
   * valuation. These were previously the same field, so listing a token
   * silently replaced its approved value on screen and the two could never be
   * shown together — the token appeared unchanged by the listing.
   */
  listedPriceUsd?: bigint;
  listedPrice?: number;
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
  /** Gateway-resolved `image` from the token metadata, when it declares one. */
  image?: string;
}

export interface DecoratedGem extends Gem {
  color: string;
  valueFmt: string;
  /** Formatted ask, present only while listed. */
  listedPriceFmt?: string;
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
  bidder: Address;
  tokenOwner: Address;
  listingSeller?: Address;
  offerFmt: string;
  from: string;
  status: 'Pending' | 'Accepted' | 'Expired' | 'Refunded';
  statusColor: string;
  secondsLeft: number;
}

export interface SwapRequest {
  offerId: bigint;
  gem: DecoratedGem;
  proposer: Address;
  requestedOwner: Address;
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
  owner: Address;
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

/**
 * A plain ERC-721 transfer of a minted token to another wallet.
 *
 * `DGENFT._update` gates only `transferLocked[tokenId]`, which is set while a
 * redemption is in flight — there is no compliance check on transfers, so the
 * recipient needs no KYC and no account here.
 */
export interface TransferTokenRequest {
  tokenId: bigint;
  to: Address;
}

/**
 * Grants one address permission to move one token, once.
 *
 * This is what a gift card rests on: the sender keeps the token, and the
 * operator holds a single-use permission it spends only when someone claims
 * the card.
 */
export interface ApproveTransferRequest {
  tokenId: bigint;
  operator: Address;
}

/**
 * Clears the standing per-token approval a gift card leaves behind.
 *
 * ERC-721 `approve` may only be called by the owner or an approved-for-all
 * operator, so the gift operator cannot revoke its own single-token approval
 * when a card expires. Only the owner can, and only from here.
 */
export interface RevokeApprovalRequest {
  tokenId: bigint;
}

export interface BidRequest {
  gemId: bigint;
  paymentAsset: Address;
  saleAmountUsd: bigint;
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
  saleAmountUsd: bigint;
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

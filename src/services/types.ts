import type { Address, Hash, Hex } from 'viem';

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
  /** Original seller recorded by GemRegistry; used before a token is minted. */
  seller?: Address;
  /**
   * Current holder of the minted token. Absent until a stone is won at auction,
   * which is the only way a token comes into existence.
   */
  owner?: Address;
  /** Set only while the token is escrowed in an active Marketplace listing. */
  listingSeller?: Address;
  /**
   * DGENFT's record of who deposited a token now held by the gift-card escrow
   * wallet. Read only for tokens that wallet holds; see `inGiftEscrow`.
   */
  escrowDepositor?: Address;
  /**
   * Whether a token held by the gift escrow wallet belongs to an open gift card
   * (from the database). Undefined when unknown; see `inGiftEscrow`.
   */
  giftEscrowed?: boolean;
  /** DGENFT transfer lock: set while a redemption request is open. */
  transferLocked?: boolean;
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
  /** Current automatic-auction leader for an escrowed listing, when any. */
  listingWinningOfferId?: bigint;
  /** Unix timestamp at which that listed-token auction becomes settleable. */
  listingAuctionEnd?: bigint;
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
  /** Current custody agreement end (ISO), when the vault custodian recorded one. */
  custodyAgreementEndsAt?: string;
  /** Whether that end date comes from a signed extension. */
  custodyAgreementAmended?: boolean;
  redeem: RedeemStatus;
  metadataUri?: string;
  /** First gateway-resolved `image` from the token metadata, when it declares one. */
  image?: string;
  /**
   * Ordered image recovery paths.
   *
   * Mobile networks routinely fail one public IPFS gateway while another is
   * healthy. Keeping every immutable candidate lets the image element advance
   * without throwing away the metadata or replacing the stone with a blank
   * platform-coloured tile.
   */
  imageCandidates?: string[];
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
  /** Sale value of the leading bid in 18-decimal USD, excluding the reserve top-up. */
  highestBidUsd?: bigint;
  highestBidder?: Address;
  bids: number;
  secondsLeft: number;
  floorUsd: bigint;
  /** Contract settlement state. Settled auctions stay visible as history. */
  settled: boolean;
  /** A settled auction either minted its token or refunded the winning bid. */
  outcome?: 'Minted' | 'Refunded';
  tokenId?: bigint;
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
  /** True when this is the automatic winning bid on an escrowed listing. */
  automatic: boolean;
  status: 'Pending' | 'Awaiting settlement' | 'Accepted' | 'Expired' | 'Refunded';
  statusColor: string;
  secondsLeft: number;
  /** Amount offered to the owner, 18-decimal USD, before any reserve top-up. */
  saleUsd: bigint;
  /** Unix expiry. Every bid in one listing auction shares the auction's end time. */
  expiry: bigint;
  /** The bidder took it back (cancelOffer), as opposed to being outbid or refunded at settlement. */
  withdrawn: boolean;
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
  /** Commitment used to join the chain request to its private workflow record. */
  requestHash?: Hash;
  /** Transaction that opened the active request. */
  transactionHash?: Hash;
  gem: DecoratedGem;
  owner: Address;
  /**
   * The only address that can finish this.
   *
   * `RedemptionManager.confirmRedemption` checks `msg.sender != gem.custodian`
   * — an exact address, not a role — so the custodian has to be carried here for
   * the UI to know whether to offer the action at all.
   */
  custodian: Address;
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
  /** Precise lifecycle time when the source provides one (for example gift records). */
  occurredAt?: string;
  /** Stable on-chain fallback order when a block timestamp was not projected. */
  chainOrder?: string;
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
  sections?: readonly {
    heading?: string;
    body: string;
  }[];
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

/** Reserve returned to a token holder after redemption, held as a pull credit. */
export interface PendingReserveCredit {
  paymentAsset: Address;
  symbol: PaymentAsset['symbol'];
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
 * Retained for approval-backed gift cards issued before operator escrow was
 * introduced, and for any other explicit single-token delegation.
 */
export interface ApproveTransferRequest {
  tokenId: bigint;
  operator: Address;
}

/**
 * Clears a standing per-token approval left by a legacy gift card.
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

/** Withdraws the caller's leading primary-auction bid before close. */
export interface CancelAuctionBidRequest {
  gemId: bigint;
}

export interface SettleAuctionRequest {
  gemId: bigint;
}

export interface SettleListingAuctionRequest {
  tokenId: bigint;
}

export interface ClaimRefundRequest {
  paymentAsset: Address;
}

export interface ClaimTreasuryPayoutRequest {
  recipient: Address;
}

export interface ClaimReserveCreditRequest {
  paymentAsset: Address;
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
  workflowIdHash: Hash;
}

export interface CancelRedemptionRequest {
  tokenId: bigint;
}

/**
 * Completes a redemption: burns the token and releases the reserve.
 *
 * Irreversible, and gated on an exact address rather than a role — only the
 * custodian recorded on the gem can call it.
 */
export interface ConfirmRedemptionRequest {
  tokenId: bigint;
}

export interface SetCollectorCommitmentRequest {
  tokenId: bigint;
  collectorCommitment: Hash;
}

export interface StartRedemptionFulfillmentRequest {
  tokenId: bigint;
}

export interface SubmitFulfillmentProofRequest {
  tokenId: bigint;
  proofDigest: Hash;
}

export interface ApproveFulfillmentProofRequest {
  tokenId: bigint;
  approvalId: Hash;
  approvalVersion: bigint;
}

export interface RejectFulfillmentProofRequest {
  tokenId: bigint;
  reasonHash: Hash;
}

export interface FinalizeRedemptionRequest {
  tokenId: bigint;
  nonce: Hash;
  issuedAt: bigint;
  deadline: bigint;
  authorizer: Address;
  signature: Hex;
}

export interface ProposeRedemptionRecoveryRequest {
  tokenId: bigint;
  evidenceDigest: Hash;
}

export interface RedemptionRecoveryActionRequest {
  tokenId: bigint;
  proposalHash: Hash;
}

export interface FundReserveRequest {
  gemId: bigint;
  paymentAsset: Address;
  amountUsd: bigint;
}

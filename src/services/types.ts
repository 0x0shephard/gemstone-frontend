/**
 * Domain models consumed by the UI. These are intentionally UI-shaped (mirroring
 * the mockup data model). A future wagmi-backed service maps on-chain reads/events
 * into these same shapes so pages never change.
 */

export type GemType = 'ruby' | 'sapphire' | 'emerald';

export type RedeemStatus = 'Eligible' | 'KYC required';

/** Core gemstone / DGE NFT model. */
export interface Gem {
  id: string;
  name: string;
  type: GemType;
  typeLabel: string;
  gemId: string;
  /** Estimated USD value. */
  value: number;
  carats: number;
  /** Reserve funded percentage (>= 100 means fully funded). */
  reserve: number;
  feeTier: string;
  feePct: number;
  custody: string;
  redeem: RedeemStatus;
}

/** A gem enriched with derived, presentational fields. */
export interface DecoratedGem extends Gem {
  color: string;
  valueFmt: string;
  caratsFmt: string;
  /** CSS background for the faux-faceted thumbnail. */
  thumb: string;
  reserveLabel: string;
  reserveColor: string;
  /** True when reserve >= 100. */
  funded: boolean;
  feeLabel: string;
  custodyLabel: string;
}

export interface Auction {
  gem: DecoratedGem;
  highestBidFmt: string;
  highestBidder?: string;
  bids: number;
  /** Seconds remaining (0 = expired). */
  secondsLeft: number;
  floorUsd: number;
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
  gem: DecoratedGem;
  offerFmt: string;
  from: string;
  status: 'Pending' | 'Declined' | 'Accepted';
  statusColor: string;
  /** Seconds until the 24h offer expires. */
  secondsLeft: number;
}

export interface SwapRequest {
  gem: DecoratedGem;
  giveName: string;
  giveId: string;
  diff: string;
  status: string;
  statusColor: string;
}

export interface Redemption {
  gem: DecoratedGem;
  stage: string;
  progress: number;
  status: string;
  statusColor: string;
}

export interface ActivityItem {
  kind: string;
  gem: string;
  gemId: string;
  amount: string;
  date: string;
  color: string;
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
  /** address(0) for native ETH. */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** USD price used for preview math. */
  usdPrice: number;
  isNative: boolean;
}

/** Result of a write action while ABIs are mocked. */
export interface TxResult {
  hash: `0x${string}`;
  status: 'success';
}

/**
 * Seed data ported verbatim from the design mockup's `renderVals()`
 * (`UI/Digital Carat.dc.html`, lines 671–876). This is the fixture the mock
 * data service serves; replace with on-chain reads when ABIs land.
 */
import type {
  Gem,
  FeeTier,
  TreasurySplitItem,
  TrustSignal,
  PaymentAsset,
  ActivityItem,
} from './types';
import { NATIVE_ASSET } from '@/config/contracts';
import { ownershipPathSteps } from '@/content/ownershipPath';

export const gems: Gem[] = [
  {
    gemId: 1n,
    tokenId: 1n,
    displayId: 'GEM-RB-0417',
    name: "Burmese Pigeon's Blood",
    type: 'ruby',
    typeLabel: 'Ruby',
    valueUsd: 248_000n * 10n ** 18n,
    value: 248000,
    carats: 3.12,
    reserve: 100,
    reserveBalanceUsd: 12_400n * 10n ** 18n,
    reserveShortfallUsd: 0n,
    feeTier: 'Tier 3',
    feePct: 0.9,
    custodyProvider: 'Brink’s',
    custodyCountry: 'Switzerland',
    redeem: 'Eligible',
  },
  {
    gemId: 2n,
    tokenId: 2n,
    displayId: 'GEM-SP-0293',
    name: 'Kashmir Cornflower',
    type: 'sapphire',
    typeLabel: 'Sapphire',
    valueUsd: 412_000n * 10n ** 18n,
    value: 412000,
    carats: 4.05,
    reserve: 82,
    reserveBalanceUsd: 16_892n * 10n ** 18n,
    reserveShortfallUsd: 3_708n * 10n ** 18n,
    feeTier: 'Tier 4',
    feePct: 0.6,
    custodyProvider: 'Malca-Amit',
    custodyCountry: 'Switzerland',
    redeem: 'KYC required',
  },
  {
    gemId: 3n,
    tokenId: 3n,
    displayId: 'GEM-EM-0155',
    name: 'Muzo Colombian',
    type: 'emerald',
    typeLabel: 'Emerald',
    valueUsd: 186_500n * 10n ** 18n,
    value: 186500,
    carats: 2.74,
    reserve: 100,
    reserveBalanceUsd: 9_325n * 10n ** 18n,
    reserveShortfallUsd: 0n,
    feeTier: 'Tier 2',
    feePct: 1.4,
    custodyProvider: 'Brink’s',
    custodyCountry: 'Switzerland',
    redeem: 'Eligible',
  },
  {
    gemId: 4n,
    tokenId: 4n,
    displayId: 'GEM-RB-0620',
    name: 'Mozambique Vivid',
    type: 'ruby',
    typeLabel: 'Ruby',
    valueUsd: 94_200n * 10n ** 18n,
    value: 94200,
    carats: 2.1,
    reserve: 100,
    reserveBalanceUsd: 4_710n * 10n ** 18n,
    reserveShortfallUsd: 0n,
    feeTier: 'Tier 1',
    feePct: 2.1,
    custodyProvider: 'Brink’s',
    custodyCountry: 'Switzerland',
    redeem: 'Eligible',
  },
  {
    gemId: 5n,
    tokenId: 5n,
    displayId: 'GEM-SP-0388',
    name: 'Ceylon Royal Blue',
    type: 'sapphire',
    typeLabel: 'Sapphire',
    valueUsd: 158_000n * 10n ** 18n,
    value: 158000,
    carats: 3.4,
    reserve: 91,
    reserveBalanceUsd: 7_189n * 10n ** 18n,
    reserveShortfallUsd: 711n * 10n ** 18n,
    feeTier: 'Tier 2',
    feePct: 1.4,
    custodyProvider: 'Malca-Amit',
    custodyCountry: 'Switzerland',
    redeem: 'Eligible',
  },
  {
    gemId: 6n,
    tokenId: 6n,
    displayId: 'GEM-EM-0207',
    name: 'Zambian Deep',
    type: 'emerald',
    typeLabel: 'Emerald',
    valueUsd: 322_000n * 10n ** 18n,
    value: 322000,
    carats: 3.88,
    reserve: 100,
    reserveBalanceUsd: 16_100n * 10n ** 18n,
    reserveShortfallUsd: 0n,
    feeTier: 'Tier 3',
    feePct: 0.9,
    custodyProvider: 'Brink’s',
    custodyCountry: 'Switzerland',
    redeem: 'KYC required',
  },
];

/** Gem ids that the mock "current user" owns (Owned tab, redeemable holdings). */
export const ownedGemIds = [1n, 3n, 4n, 6n];

/** Auctions: [gemId, highestBid, bidCount, secondsLeft]. */
export const auctionSeeds: Array<[bigint, number, number, number]> = [
  [2n, 388000, 14, 22462], // 06:14:22
  [4n, 88500, 9, 42423], // 11:47:03
  [6n, 305000, 21, 9115], // 02:31:55
];

/** Active bids: [gemId, myBid, topBid, status, secondsLeft]. */
export const bidSeeds: Array<[bigint, number, number, 'Leading' | 'Outbid', number]> = [
  [2n, 372000, 388000, 'Outbid', 22462],
  [6n, 305000, 305000, 'Leading', 9115],
];

/** Offers: [gemId, amount, from, status, secondsLeft]. */
export const offerSeeds: Array<
  [bigint, bigint, number, string, 'Pending' | 'Accepted' | 'Expired' | 'Refunded', number]
> = [
  [1n, 1n, 232000, '0x91c4…2a7d', 'Pending', 61200],
  [2n, 3n, 178000, '0x44be…f019', 'Pending', 43800],
  [3n, 4n, 90000, '0x77aa…c318', 'Expired', 0],
];

/** Swap requests: [gemId (you receive), giveGemId (you give), diffText, status]. */
export const swapSeeds: Array<
  [bigint, bigint, bigint, string, 'Active' | 'Accepted' | 'Cancelled' | 'Expired']
> = [[1n, 3n, 4n, '+$92,300 to you', 'Active']];

/** Redemptions: [gemId, stage, progress, status]. */
export const redemptionSeeds: Array<[string, bigint, string, number, string]> = [
  ['demo-redemption-1', 1n, 'Eligibility check', 40, 'In review'],
];

export const activity: ActivityItem[] = [
  {
    kind: 'Purchase',
    gem: 'Mozambique Vivid',
    displayId: 'GEM-RB-0620',
    amount: '-$94,200',
    date: 'Jul 12, 2026',
    color: 'var(--dc-ruby)',
  },
  {
    kind: 'Bid placed',
    gem: 'Kashmir Cornflower',
    displayId: 'GEM-SP-0293',
    amount: '-$372,000',
    date: 'Jul 11, 2026',
    color: 'var(--dc-sapphire)',
  },
  {
    kind: 'Reserve top-up',
    gem: 'Ceylon Royal Blue',
    displayId: 'GEM-SP-0388',
    amount: '-$14,220',
    date: 'Jul 09, 2026',
    color: 'var(--dc-amber)',
  },
  {
    kind: 'Swap received',
    gem: 'Muzo Colombian',
    displayId: 'GEM-EM-0155',
    amount: '+1 gem',
    date: 'Jul 02, 2026',
    color: 'var(--dc-emerald)',
  },
  {
    kind: 'Sale settled',
    gem: 'Andesine Star',
    displayId: 'GEM-RB-0090',
    amount: '+$61,400',
    date: 'Jun 28, 2026',
    color: 'var(--dc-emerald)',
  },
];

export const feeTiers: FeeTier[] = [
  { tier: 'Tier 1', range: 'Under $100k', pct: '2.1%' },
  { tier: 'Tier 2', range: '$100k – $200k', pct: '1.4%' },
  { tier: 'Tier 3', range: '$200k – $300k', pct: '0.9%' },
  { tier: 'Tier 4', range: 'Over $300k', pct: '0.6%' },
];

export const treasurySplit: TreasurySplitItem[] = [
  { label: 'Seller', pct: '80%', color: 'var(--dc-frost)' },
  { label: 'Platform', pct: '8%', color: '#8B8B94' },
  { label: 'Vault reserve', pct: '6%', color: 'var(--dc-sapphire)' },
  { label: 'Insurance reserve', pct: '4%', color: 'var(--dc-emerald)' },
  { label: 'Treasury reserve', pct: '2%', color: 'var(--dc-ruby)' },
];

export const trustSignals: TrustSignal[] = [
  {
    title: 'Custody verified',
    sub: 'Third-party vault attestation',
    color: 'var(--dc-emerald)',
  },
  { title: 'Reserve funded', sub: 'On-chain backing per gem', color: 'var(--dc-sapphire)' },
  { title: 'Insured storage', sub: "Lloyd's-underwritten", color: 'var(--dc-frost)' },
  { title: 'Redeemable asset', sub: 'Claim the physical stone', color: 'var(--dc-ruby)' },
];

export const howSteps = [...ownershipPathSteps];

/** Accepted payment assets (from PaymentTokenRegistry, mocked). */
export const paymentAssets: PaymentAsset[] = [
  {
    address: NATIVE_ASSET,
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    usdPrice: 3400,
    enabled: true,
    isNative: true,
  },
  {
    address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    usdPrice: 1,
    enabled: true,
    isNative: false,
  },
];

/** Mock protocol-level stats for the landing page. */
export const protocolStats = {
  gemsInVault: 148,
  featuredCaption: 'GEM-RB-0417 · Burmese Ruby · 3.12ct',
};

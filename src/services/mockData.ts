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
  HowStep,
  PaymentAsset,
  ActivityItem,
} from './types';
import { NATIVE_ASSET } from '@/config/contracts';

export const gems: Gem[] = [
  { id: 'g1', name: "Burmese Pigeon's Blood", type: 'ruby', typeLabel: 'Ruby', gemId: 'GEM-RB-0417', value: 248000, carats: 3.12, reserve: 100, feeTier: 'Tier 3', feePct: 0.9, custody: 'Vault ZUR-04', redeem: 'Eligible' },
  { id: 'g2', name: 'Kashmir Cornflower', type: 'sapphire', typeLabel: 'Sapphire', gemId: 'GEM-SP-0293', value: 412000, carats: 4.05, reserve: 82, feeTier: 'Tier 4', feePct: 0.6, custody: 'Vault GVA-01', redeem: 'KYC required' },
  { id: 'g3', name: 'Muzo Colombian', type: 'emerald', typeLabel: 'Emerald', gemId: 'GEM-EM-0155', value: 186500, carats: 2.74, reserve: 100, feeTier: 'Tier 2', feePct: 1.4, custody: 'Vault ZUR-04', redeem: 'Eligible' },
  { id: 'g4', name: 'Mozambique Vivid', type: 'ruby', typeLabel: 'Ruby', gemId: 'GEM-RB-0620', value: 94200, carats: 2.10, reserve: 100, feeTier: 'Tier 1', feePct: 2.1, custody: 'Vault ZUR-04', redeem: 'Eligible' },
  { id: 'g5', name: 'Ceylon Royal Blue', type: 'sapphire', typeLabel: 'Sapphire', gemId: 'GEM-SP-0388', value: 158000, carats: 3.40, reserve: 91, feeTier: 'Tier 2', feePct: 1.4, custody: 'Vault GVA-01', redeem: 'Eligible' },
  { id: 'g6', name: 'Zambian Deep', type: 'emerald', typeLabel: 'Emerald', gemId: 'GEM-EM-0207', value: 322000, carats: 3.88, reserve: 100, feeTier: 'Tier 3', feePct: 0.9, custody: 'Vault ZUR-04', redeem: 'KYC required' },
];

/** Gem ids that the mock "current user" owns (Owned tab, redeemable holdings). */
export const ownedGemIds = ['g1', 'g3', 'g4', 'g6'];

/** Auctions: [gemId, highestBid, bidCount, secondsLeft]. */
export const auctionSeeds: Array<[string, number, number, number]> = [
  ['g2', 388000, 14, 22462], // 06:14:22
  ['g4', 88500, 9, 42423], // 11:47:03
  ['g6', 305000, 21, 9115], // 02:31:55
];

/** Active bids: [gemId, myBid, topBid, status, secondsLeft]. */
export const bidSeeds: Array<[string, number, number, 'Leading' | 'Outbid', number]> = [
  ['g2', 372000, 388000, 'Outbid', 22462],
  ['g6', 305000, 305000, 'Leading', 9115],
];

/** Offers: [gemId, amount, from, status, secondsLeft]. */
export const offerSeeds: Array<[string, number, string, 'Pending' | 'Declined' | 'Accepted', number]> = [
  ['g1', 232000, '0x91c4…2a7d', 'Pending', 61200],
  ['g3', 178000, '0x44be…f019', 'Pending', 43800],
  ['g4', 90000, '0x77aa…c318', 'Declined', 0],
];

/** Swap requests: [gemId (you receive), giveGemId (you give), diffText, status]. */
export const swapSeeds: Array<[string, string, string, string]> = [
  ['g3', 'g4', '+$92,300 to you', 'Awaiting response'],
];

/** Redemptions: [gemId, stage, progress, status]. */
export const redemptionSeeds: Array<[string, string, number, string]> = [
  ['g1', 'Eligibility check', 40, 'In review'],
];

export const activity: ActivityItem[] = [
  { kind: 'Purchase', gem: 'Mozambique Vivid', gemId: 'GEM-RB-0620', amount: '-$94,200', date: 'Jul 12, 2026', color: '#E5484D' },
  { kind: 'Bid placed', gem: 'Kashmir Cornflower', gemId: 'GEM-SP-0293', amount: '-$372,000', date: 'Jul 11, 2026', color: '#5B8DEF' },
  { kind: 'Reserve top-up', gem: 'Ceylon Royal Blue', gemId: 'GEM-SP-0388', amount: '-$14,220', date: 'Jul 09, 2026', color: '#E5A23C' },
  { kind: 'Swap received', gem: 'Muzo Colombian', gemId: 'GEM-EM-0155', amount: '+1 gem', date: 'Jul 02, 2026', color: '#35B98A' },
  { kind: 'Sale settled', gem: 'Andesine Star', gemId: 'GEM-RB-0090', amount: '+$61,400', date: 'Jun 28, 2026', color: '#35B98A' },
];

export const feeTiers: FeeTier[] = [
  { tier: 'Tier 1', range: 'Under $100k', pct: '2.1%' },
  { tier: 'Tier 2', range: '$100k – $200k', pct: '1.4%' },
  { tier: 'Tier 3', range: '$200k – $300k', pct: '0.9%' },
  { tier: 'Tier 4', range: 'Over $300k', pct: '0.6%' },
];

export const treasurySplit: TreasurySplitItem[] = [
  { label: 'Seller', pct: '82%', color: '#D7D7DD' },
  { label: 'Platform', pct: '6%', color: '#8B8B94' },
  { label: 'Vault reserve', pct: '6%', color: '#5B8DEF' },
  { label: 'Insurance reserve', pct: '3%', color: '#35B98A' },
  { label: 'Treasury reserve', pct: '3%', color: '#E5484D' },
];

export const trustSignals: TrustSignal[] = [
  { title: 'Custody verified', sub: 'Third-party vault attestation', color: '#35B98A' },
  { title: 'Reserve funded', sub: 'On-chain backing per gem', color: '#5B8DEF' },
  { title: 'Insured storage', sub: "Lloyd's-underwritten", color: '#D7D7DD' },
  { title: 'Redeemable asset', sub: 'Claim the physical stone', color: '#E5484D' },
];

export const howSteps: HowStep[] = [
  { num: '01', title: 'Certify & vault', body: 'A gemologist grades the stone; it enters an insured custodian vault with a public attestation.' },
  { num: '02', title: 'Fund reserve', body: 'A reserve is posted on-chain to back the asset. Mint is blocked until the reserve is fully funded.' },
  { num: '03', title: 'Mint & trade', body: 'The gem is minted as an NFT. Buy directly, bid in auction, or acquire on the secondary market.' },
  { num: '04', title: 'Redeem or hold', body: 'Hold the token, swap it, or redeem: the NFT locks and burns as the physical stone is released.' },
];

/** Accepted payment assets (from PaymentTokenRegistry, mocked). */
export const paymentAssets: PaymentAsset[] = [
  { address: NATIVE_ASSET, symbol: 'ETH', name: 'Ether', decimals: 18, usdPrice: 3400, isNative: true },
  { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', symbol: 'USDC', name: 'USD Coin', decimals: 6, usdPrice: 1, isNative: false },
  { address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06', symbol: 'USDT', name: 'Tether USD', decimals: 6, usdPrice: 1, isNative: false },
];

/** Mock protocol-level stats for the landing page. */
export const protocolStats = {
  gemsInVault: 148,
  featuredCaption: 'GEM-RB-0417 · Burmese Ruby · 3.12ct',
};

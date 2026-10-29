import type { OperationsCapability } from '@/services/offchain/operations';

/** Header title + subtitle per app route (mirrors the mockup `titles` map). */
export const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/marketplace': {
    title: 'Tokens Marketplace',
    subtitle: 'Buy verified gemstone NFTs, directly or on the secondary market',
  },
  '/auctions': {
    title: 'Auctions',
    subtitle: '24-hour timed auctions · settlement automated on expiry',
  },
  '/swaps': { title: 'Swaps', subtitle: 'Propose and accept gem-for-gem exchange offers' },
  '/redeem': {
    title: 'Redeem',
    subtitle: 'Lock, verify and burn a token to claim the physical gemstone',
  },
  '/profile': { title: 'Portfolio', subtitle: 'Your gemstone holdings and protocol activity' },
  '/seller': { title: 'Seller portal', subtitle: 'Submit gemstones and manage seller status' },
  '/gemlab': {
    title: 'Gem lab',
    subtitle: 'Review evidence, appraise stones and propose valuation matrices',
  },
  '/bank': {
    title: 'Vault custodian',
    subtitle: 'Store arriving stones and release redeemed ones',
  },
  '/custodian': {
    title: 'Delivery custodian',
    subtitle: 'Deliver redeemed stones to the pickup point or the holder',
  },
  '/verify': {
    title: 'Operations admin',
    subtitle: 'Review lifecycle evidence, approvals and append-only corrections',
  },
  '/about': { title: 'About Digital Carat', subtitle: 'The vault for tokenized gemstones' },
};

/**
 * The capability each hidden operations route is gated on, matching the
 * `OperationsAccessGate` on its page.
 */
export const OPS_ROUTE_CAPABILITY: Readonly<Record<string, OperationsCapability>> = {
  '/verify': 'admin.read',
  '/gemlab': 'gemlab.read',
  '/bank': 'bank.receive',
  '/custodian': 'custodian.fulfill',
};

/** Whether the viewer may see an operations route: known yes, known no, or not yet known. */
export type OpsAccess = 'granted' | 'denied' | 'pending';

export const NOT_FOUND_META = { title: 'Page not found', subtitle: '' } as const;
const NEUTRAL_META = { title: 'Digital Carat', subtitle: '' } as const;

/**
 * The header for a path.
 *
 * Operations routes are hidden: a non-member gets "Page not found" in the page
 * body, and the header must agree. Printing "Operations admin" above "Page not
 * found" confirmed the very route the body was denying. While access is still
 * being checked the header names nothing.
 */
export function metaForPath(
  pathname: string,
  opsAccess: OpsAccess = 'denied',
): { title: string; subtitle: string } {
  if (pathname.startsWith('/gem/')) {
    return { title: 'Gem detail', subtitle: 'Verified gemstone · reserve · custody' };
  }
  if (OPS_ROUTE_CAPABILITY[pathname] && opsAccess !== 'granted') {
    return opsAccess === 'pending' ? NEUTRAL_META : NOT_FOUND_META;
  }
  return PAGE_META[pathname] ?? { title: 'Digital Carat', subtitle: '' };
}

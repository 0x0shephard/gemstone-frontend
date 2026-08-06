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
  '/about': { title: 'About Digital Carat', subtitle: 'The vault for tokenized gemstones' },
};

export function metaForPath(pathname: string): { title: string; subtitle: string } {
  if (pathname.startsWith('/gem/')) {
    return { title: 'Gem detail', subtitle: 'Verified gemstone · reserve · custody' };
  }
  return PAGE_META[pathname] ?? { title: 'Digital Carat', subtitle: '' };
}

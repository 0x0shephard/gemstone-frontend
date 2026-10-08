import type { ReactNode } from 'react';
import type { OperationsAccess } from '@/services/offchain/operations';

export type NavItem = {
  label: string;
  shortLabel?: string;
  to: string;
  icon: ReactNode;
};

function Icon({ children, viewBox = '0 0 24 24' }: { children: ReactNode; viewBox?: string }) {
  return (
    <svg
      aria-hidden
      viewBox={viewBox}
      className="h-[18px] w-[18px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const navigationGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Discover',
    items: [
      {
        label: 'Token Marketplace',
        shortLabel: 'Market',
        to: '/marketplace',
        icon: (
          <Icon>
            <path d="m12 3 7.5 6-3 10h-9l-3-10L12 3Z" />
            <path d="m4.5 9 7.5 3 7.5-3M12 12v7" />
          </Icon>
        ),
      },
      {
        label: 'Gemstone Auctions',
        shortLabel: 'Auctions',
        to: '/auctions',
        icon: (
          <Icon>
            <path d="M5 19h14M8 16h8M9.5 16V8.5h5V16" />
            <path d="m7 8.5 5-4 5 4" />
          </Icon>
        ),
      },
    ],
  },
  {
    label: 'Ownership',
    items: [
      {
        label: 'Swaps',
        shortLabel: 'Swap',
        to: '/swaps',
        icon: (
          <Icon>
            <path d="M5 8h13l-3-3M19 16H6l3 3" />
          </Icon>
        ),
      },
      {
        label: 'Redeem',
        to: '/redeem',
        icon: (
          <Icon>
            <path d="M12 3 5.5 8v8L12 21l6.5-5V8L12 3Z" />
            <path d="M8.5 11.5 12 14l3.5-2.5" />
          </Icon>
        ),
      },
      {
        label: 'Portfolio',
        to: '/profile',
        icon: (
          <Icon>
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <path d="M8 5V3M16 5V3M4 10h16M8 14h3" />
          </Icon>
        ),
      },
    ],
  },
  {
    label: 'Partner',
    items: [
      {
        label: 'Seller portal',
        to: '/seller',
        icon: (
          <Icon>
            <path d="M5 20V8l7-4 7 4v12M9 20v-6h6v6M4 20h16" />
          </Icon>
        ),
      },
    ],
  },
  {
    label: 'Protocol',
    items: [
      {
        label: 'How it works',
        to: '/about',
        icon: (
          <Icon>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 11v5M12 8h.01" />
          </Icon>
        ),
      },
    ],
  },
];

const staffRoute = (label: string, shortLabel: string, to: string, initials: string): NavItem => ({
  label,
  shortLabel,
  to,
  icon: (
    <span
      aria-hidden
      className="inline-flex h-[18px] min-w-[18px] items-center justify-center font-mono text-[8px] font-semibold tracking-[-0.04em]"
    >
      {initials}
    </span>
  ),
});

/** Staff destinations are disclosed only after the server grants a capability. */
export function staffNavigation(access?: OperationsAccess | null): NavItem[] {
  if (!access) return [];
  const capabilities = new Set(access.capabilities);
  const items: NavItem[] = [];
  if (capabilities.has('gemlab.read')) {
    items.push(staffRoute('Gem lab', 'Lab', '/gemlab', 'GL'));
  }
  if (capabilities.has('bank.receive')) {
    items.push(staffRoute('Vault custodian', 'Vault', '/bank', 'VC'));
  }
  if (capabilities.has('custodian.fulfill')) {
    items.push(staffRoute('Delivery custodian', 'Delivery', '/custodian', 'DC'));
  }
  if (capabilities.has('admin.read')) {
    items.push(staffRoute('Operations admin', 'Admin', '/verify', 'OP'));
  }
  return items;
}

/**
 * Bids placed on an already-minted token — the Portfolio's "Token Bids" tab.
 *
 * Not a group entry: it is a view of Portfolio rather than a separate
 * destination, and duplicating it in the sidebar would imply otherwise. Swaps
 * moves to the dock's "More" sheet, where the sidebar still lists it.
 */
export const tokenBidsItem: NavItem = {
  label: 'Token Bids',
  shortLabel: 'Bids',
  to: '/profile?tab=offers',
  icon: (
    <Icon>
      <path d="M4 18h16M7 18v-5M12 18V8M17 18v-8" />
      <path d="m5 9 4-3 4 2 6-4" />
    </Icon>
  ),
};

export const primaryMobileItems = [
  navigationGroups[0].items[0],
  navigationGroups[0].items[1],
  tokenBidsItem,
  navigationGroups[1].items[2],
];

export function groupForPath(pathname: string): string {
  if (pathname.startsWith('/gem/')) return 'Discover';
  if (['/gemlab', '/bank', '/custodian', '/verify'].includes(pathname)) return 'Operations';
  return (
    navigationGroups.find((group) => group.items.some((item) => pathname === item.to))?.label ??
    'Private vault'
  );
}

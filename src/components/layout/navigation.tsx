import type { ReactNode } from 'react';

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
        label: 'Marketplace',
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
        label: 'Auctions',
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
        shortLabel: 'Vault',
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

export const primaryMobileItems = [
  navigationGroups[0].items[0],
  navigationGroups[0].items[1],
  navigationGroups[1].items[0],
  navigationGroups[1].items[2],
];

export function groupForPath(pathname: string): string {
  if (pathname.startsWith('/gem/')) return 'Discover';
  return (
    navigationGroups.find((group) => group.items.some((item) => pathname === item.to))?.label ??
    'Private vault'
  );
}

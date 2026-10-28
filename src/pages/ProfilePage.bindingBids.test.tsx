import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import type { Bid, BindingRule, Offer } from '@/services/types';

vi.mock('@/services', () => ({ dataService: {} }));
vi.mock('@/components/tx/TxButton', () => ({
  TxButton: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

import { bidColumns, offerColumns } from './ProfilePage';

const BIDDER = '0x1111111111111111111111111111111111111111' as Address;
const OWNER = '0x2222222222222222222222222222222222222222' as Address;
const WEEK = 7 * 24 * 60 * 60;
const binding: BindingRule = { binding: true, settlementGraceSeconds: WEEK };
const legacy: BindingRule = { binding: false, settlementGraceSeconds: 0 };
const now = () => BigInt(Math.floor(Date.now() / 1000));

const gem = { gemId: 1n, tokenId: 7n, name: 'Stone', displayId: 'DC-1' } as Bid['gem'];

const leadingBid: Bid = {
  gem,
  myBidFmt: '$1,000',
  topBidFmt: '$1,000',
  status: 'Leading',
  statusColor: 'green',
  secondsLeft: 3600,
};

const offer = (overrides: Partial<Offer>): Offer =>
  ({
    offerId: 9n,
    gem,
    bidder: BIDDER,
    tokenOwner: OWNER,
    offerFmt: '$1,000',
    from: 'me',
    automatic: true,
    status: 'Pending',
    statusColor: 'green',
    secondsLeft: 3600,
    saleUsd: 1_000n * 10n ** 18n,
    expiry: now() + 3600n,
    withdrawn: false,
    ...overrides,
  }) as Offer;

const renderCell = <T,>(
  columns: { key: string; render?: (row: T) => React.ReactNode }[],
  key: string,
  row: T,
) => render(<div>{columns.find((column) => column.key === key)!.render!(row)}</div>);

describe('binding leading bids', () => {
  it('offers no cancel on a leading primary bid once the contract makes it binding', () => {
    renderCell(bidColumns(binding), 'actions', leadingBid);
    expect(screen.queryByRole('button', { name: 'Cancel bid' })).toBeNull();
    expect(screen.getByText('Binding until settled')).toBeInTheDocument();
  });

  it('keeps the cancel on contracts from before binding bids', () => {
    renderCell(bidColumns(legacy), 'actions', leadingBid);
    expect(screen.getByRole('button', { name: 'Cancel bid' })).toBeInTheDocument();
  });

  it('hides "Withdraw bid" on the winning listing bid while it is binding', () => {
    renderCell(offerColumns(BIDDER, new Map(), binding), 'action', offer({}));
    expect(screen.queryByRole('button', { name: 'Withdraw bid' })).toBeNull();
  });

  it('still lets a bidder withdraw an ordinary offer, and a winning bid on old contracts', () => {
    renderCell(offerColumns(BIDDER, new Map(), binding), 'action', offer({ automatic: false }));
    expect(screen.getByRole('button', { name: 'Withdraw bid' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'Withdraw bid' }).remove();
    renderCell(offerColumns(BIDDER, new Map(), legacy), 'action', offer({}));
    expect(screen.getByRole('button', { name: 'Withdraw bid' })).toBeInTheDocument();
  });

  it('offers the exit only once an unsettled winning bid is past the grace period', () => {
    const ended = offer({ status: 'Awaiting settlement', secondsLeft: 0, expiry: now() - 3600n });
    renderCell(offerColumns(BIDDER, new Map(), binding), 'action', ended);
    expect(screen.getByRole('button', { name: 'Settle now' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw bid' })).toBeNull();

    const stale = offer({
      status: 'Awaiting settlement',
      secondsLeft: 0,
      expiry: now() - BigInt(WEEK) - 1n,
    });
    renderCell(offerColumns(BIDDER, new Map(), binding), 'action', stale);
    expect(screen.getByRole('button', { name: 'Withdraw bid' })).toBeInTheDocument();
  });

  it('offers no withdrawal of any kind before the contract has answered', () => {
    const ended = offer({ status: 'Awaiting settlement', secondsLeft: 0, expiry: now() - 3600n });
    renderCell(offerColumns(BIDDER, new Map(), undefined), 'action', ended);
    expect(screen.queryByRole('button', { name: 'Withdraw bid' })).toBeNull();
    renderCell(offerColumns(BIDDER, new Map(), undefined), 'action', offer({}));
    expect(screen.queryByRole('button', { name: 'Withdraw bid' })).toBeNull();
    renderCell(bidColumns(undefined), 'actions', leadingBid);
    expect(screen.queryByRole('button', { name: 'Cancel bid' })).toBeNull();
  });
});

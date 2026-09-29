import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActivityItem } from '@/services/types';
import { sortActivityItems, TransactionHistory } from './TransactionHistory';

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: null }),
}));

function renderHistory(items: ActivityItem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TransactionHistory items={items} />
    </QueryClientProvider>,
  );
}

describe('TransactionHistory', () => {
  it('orders mixed gift and chain rows by timestamp when both sources provide one', () => {
    const rows = sortActivityItems([
      {
        kind: 'Gift prepared',
        gem: 'Gift card',
        displayId: 'Token #1',
        amount: '—',
        date: '29/09/2026',
        occurredAt: '2026-09-29T10:00:00.000Z',
        color: 'amber',
      },
      {
        kind: 'Token bid accepted',
        gem: 'Ruby',
        displayId: 'DGE-1',
        amount: '$100',
        date: 'Block 100',
        occurredAt: '2026-09-29T11:00:00.000Z',
        chainOrder: '00000000000000000000000000000100:0000000001',
        color: 'green',
      },
    ]);

    expect(rows.map((row) => row.kind)).toEqual(['Token bid accepted', 'Gift prepared']);
  });

  it('uses block and log order deterministically when chain timestamps are unavailable', () => {
    const rows = sortActivityItems([
      {
        kind: 'Older chain event',
        gem: 'Ruby',
        displayId: 'DGE-1',
        amount: '—',
        date: 'Block 99',
        chainOrder: '00000000000000000000000000000099:0000000009',
        color: 'green',
      },
      {
        kind: 'Newer chain event',
        gem: 'Ruby',
        displayId: 'DGE-1',
        amount: '—',
        date: 'Block 100',
        chainOrder: '00000000000000000000000000000100:0000000000',
        color: 'green',
      },
    ]);

    expect(rows.map((row) => row.kind)).toEqual(['Newer chain event', 'Older chain event']);
  });

  it('keeps older events reachable instead of silently truncating them', async () => {
    const items = Array.from({ length: 55 }, (_, index) => ({
      kind: `Event ${index + 1}`,
      gem: 'Gem',
      displayId: `GEM-${index + 1}`,
      amount: '—',
      date: `Block ${1000 - index}`,
      color: 'var(--dc-emerald)',
    }));
    renderHistory(items);

    expect(screen.getByText('Event 50')).toBeInTheDocument();
    expect(screen.queryByText('Event 51')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /load older events/i }));
    expect(screen.getByText('Event 55')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load older events/i })).not.toBeInTheDocument();
  });
});

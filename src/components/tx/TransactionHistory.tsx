import type { ActivityItem } from '@/services/types';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { listGiftCards } from '@/services/offchain/gift';

const columns: Column<ActivityItem>[] = [
  {
    key: 'kind',
    header: 'Event',
    render: (r) => (
      <span className="inline-flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />
        {r.kind}
      </span>
    ),
  },
  {
    key: 'gem',
    header: 'Gem',
    render: (r) => (
      <span>
        {r.gem} <span className="font-mono text-[11.5px] text-ink-dim">· {r.displayId}</span>
      </span>
    ),
  },
  { key: 'amt', header: 'Amount', align: 'right', mono: true, render: (r) => r.amount },
  {
    key: 'date',
    header: 'Date',
    align: 'right',
    render: (r) => <span className="text-ink-muted">{r.date}</span>,
  },
];

/** Protocol activity / transaction history table. */
export function TransactionHistory({ items }: { items: ActivityItem[] }) {
  const { user } = useAuth();
  const { data: giftCards = [] } = useQuery({
    queryKey: ['giftCards', user?.id ?? 'anonymous'],
    queryFn: listGiftCards,
    enabled: Boolean(user),
  });
  const giftHistory: ActivityItem[] = giftCards.map((card) => ({
    kind:
      card.status === 'active'
        ? 'Gift card issued'
        : card.status === 'claimed'
          ? 'Gift card claimed'
          : card.status === 'cancelled'
            ? 'Gift card cancelled'
            : 'Gift card prepared',
    gem: 'Gift card',
    displayId: `Token #${card.token_id}`,
    amount: '—',
    date: new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(card.created_at)),
    color:
      card.status === 'claimed' || card.status === 'active'
        ? 'var(--dc-emerald)'
        : 'var(--dc-amber)',
  }));
  return (
    <DataTable
      columns={columns}
      rows={[...giftHistory, ...items]}
      rowKey={(r, i) => `${r.kind}-${r.displayId}-${i}`}
      empty="No transactions yet."
    />
  );
}

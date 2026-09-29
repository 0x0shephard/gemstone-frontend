import type { ActivityItem } from '@/services/types';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { listGiftCardEvents } from '@/services/offchain/gift';
import { Button } from '@/components/ui/Button';
import { explorerTxUrl } from '@/config/chains';
import { useState } from 'react';

const HISTORY_PAGE_SIZE = 50;

/**
 * Sort every history result rather than abandoning the entire ordering when a
 * legacy chain row has no timestamp. Precise timestamps compare across all
 * sources; projected chain rows fall back to their block/log position. The
 * original index is the final tie-breaker so repeated renders remain stable.
 */
export function sortActivityItems(items: ActivityItem[]): ActivityItem[] {
  const timestamp = (item: ActivityItem) => {
    if (!item.occurredAt) return undefined;
    const value = new Date(item.occurredAt).getTime();
    return Number.isFinite(value) ? value : undefined;
  };
  return items
    .map((item, index) => ({ item, index, timestamp: timestamp(item) }))
    .sort((left, right) => {
      if (left.timestamp !== undefined && right.timestamp !== undefined) {
        const timeOrder = right.timestamp - left.timestamp;
        if (timeOrder) return timeOrder;
        if (left.item.chainOrder && right.item.chainOrder) {
          return (
            right.item.chainOrder.localeCompare(left.item.chainOrder) || left.index - right.index
          );
        }
        return left.index - right.index;
      }
      if (left.item.chainOrder && right.item.chainOrder) {
        return (
          right.item.chainOrder.localeCompare(left.item.chainOrder) || left.index - right.index
        );
      }
      if (left.timestamp !== undefined) return -1;
      if (right.timestamp !== undefined) return 1;
      if (left.item.chainOrder) return -1;
      if (right.item.chainOrder) return 1;
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

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
    render: (r) =>
      r.txHash ? (
        <a
          href={explorerTxUrl(r.txHash)}
          target="_blank"
          rel="noreferrer"
          className="text-ink-muted underline decoration-line/30 underline-offset-2 hover:text-ink"
        >
          {r.date} ↗
        </a>
      ) : (
        <span className="text-ink-muted">{r.date}</span>
      ),
  },
];

/** Protocol activity / transaction history table. */
export function TransactionHistory({ items }: { items: ActivityItem[] }) {
  const { user } = useAuth();
  const [visibleRows, setVisibleRows] = useState(HISTORY_PAGE_SIZE);
  const {
    data: giftEvents = [],
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['giftCardEvents', user?.id ?? 'anonymous'],
    queryFn: listGiftCardEvents,
    enabled: Boolean(user),
    placeholderData: (previous) => previous,
  });
  const eventLabel = {
    prepared: 'Gift prepared',
    escrowed: 'Gift escrowed',
    claim_submitted: 'Gift claim submitted',
    claimed: 'Gift claimed',
    cancel_submitted: 'Gift return submitted',
    cancelled: 'Gift cancelled',
  } as const;
  const giftHistory: ActivityItem[] = giftEvents.map((event) => ({
    kind: eventLabel[event.event_type],
    gem: 'Gift card',
    displayId: `Token #${event.token_id}`,
    amount: '—',
    date: new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(event.occurred_at)),
    occurredAt: event.occurred_at,
    color:
      event.event_type === 'claimed' || event.event_type === 'escrowed'
        ? 'var(--dc-emerald)'
        : 'var(--dc-amber)',
    txHash: event.transaction_hash as ActivityItem['txHash'],
  }));
  const mergedHistory = sortActivityItems([...giftHistory, ...items]);
  const displayedHistory = mergedHistory.slice(0, visibleRows);
  return (
    <div className="space-y-2">
      {isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-amber/25 bg-amber/[0.07] px-3 py-2 text-[12px] text-amber"
        >
          <span>
            {giftEvents.length > 0
              ? 'Gift history refresh failed. Showing the last result.'
              : error instanceof Error
                ? error.message
                : 'Gift history could not be loaded.'}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      )}
      {isFetching && giftEvents.length > 0 && (
        <p className="text-[11.5px] text-ink-dim">Refreshing gift history…</p>
      )}
      <DataTable
        columns={columns}
        rows={displayedHistory}
        rowKey={(r, i) => `${r.kind}-${r.displayId}-${r.txHash ?? i}`}
        empty={isFetching ? 'Loading transaction history…' : 'No transactions yet.'}
      />
      {displayedHistory.length < mergedHistory.length && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-[11.5px] text-ink-dim">
            Showing {displayedHistory.length} of {mergedHistory.length} events
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setVisibleRows((count) => count + HISTORY_PAGE_SIZE)}
          >
            Load older events
          </Button>
        </div>
      )}
    </div>
  );
}

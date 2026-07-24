import type { ActivityItem } from '@/services/types';
import { DataTable, type Column } from '@/components/ui/DataTable';

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
  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={(r, i) => `${r.kind}-${r.displayId}-${i}`}
      empty="No transactions yet."
    />
  );
}

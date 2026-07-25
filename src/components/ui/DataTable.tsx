import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
  mono?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  empty?: React.ReactNode;
  className?: string;
}

/** Dark data table: uppercase header row + mono figures, silver hairline rows. */
export function DataTable<T>({ columns, rows, rowKey, empty, className }: DataTableProps<T>) {
  return (
    <div className={cn('overflow-x-auto rounded-[18px] border border-white/[0.08] bg-card', className)}>
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr className="bg-white/[0.025]">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'px-4 py-3.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim',
                  c.align === 'right' && 'text-right',
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-[13px] text-ink-dim">
                {empty ?? 'Nothing here yet.'}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                className="border-t border-white/[0.055] bg-card transition-colors hover:bg-white/[0.018]"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-4 py-3.5 text-[13px] text-ink-soft',
                      c.align === 'right' && 'text-right',
                      c.mono && 'font-mono tabular-nums',
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

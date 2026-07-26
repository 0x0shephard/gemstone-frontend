import { cn } from '@/lib/cn';

interface StatTileProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  valueColor?: string;
  dot?: string;
  className?: string;
}

/** KPI / stat tile: muted label + large mono-ish value. */
export function StatTile({ label, value, hint, valueColor, dot, className }: StatTileProps) {
  return (
    <div className={cn('dc-surface rounded-[4px] p-[18px]', className)}>
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.15em] text-ink-dim">
        {label}
      </div>
      <div
        className="mt-2.5 flex items-center gap-2 font-mono text-[22px] font-semibold leading-none tracking-[-0.035em]"
        style={{ color: valueColor }}
      >
        {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}
        {value}
      </div>
      {hint && <div className="mt-1.5 text-[12.5px] text-ink-dim">{hint}</div>}
    </div>
  );
}

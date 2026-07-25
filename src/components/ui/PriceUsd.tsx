import { cn } from '@/lib/cn';
import { fmtUsd } from '@/lib/format';

interface PriceUsdProps {
  value: number;
  compact?: boolean;
  className?: string;
}

/** USD figure rendered in the mono figure style. */
export function PriceUsd({ value, compact, className }: PriceUsdProps) {
  return (
    <span className={cn('font-mono tabular-nums', className)}>{fmtUsd(value, { compact })}</span>
  );
}

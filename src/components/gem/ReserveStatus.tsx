import type { DecoratedGem } from '@/services/types';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { reserveShortfallUsd } from '@/lib/gem';
import { fmtUsd } from '@/lib/format';
import { cn } from '@/lib/cn';

interface ReserveStatusProps {
  gem: DecoratedGem;
  /** Show the USD shortfall callout when reserve is short. */
  showShortfall?: boolean;
  className?: string;
}

/**
 * Reserve funding indicator. Never hides the shortfall — surfaces the amber
 * "top-up required" state prominently, per protocol UX rules.
 */
export function ReserveStatus({ gem, showShortfall = true, className }: ReserveStatusProps) {
  const shortfall = reserveShortfallUsd(gem);
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between text-[12px]">
        <span className="uppercase tracking-[0.12em] text-ink-muted">Reserve</span>
        <span className="font-semibold" style={{ color: gem.reserveColor }}>
          {gem.reserveLabel}
        </span>
      </div>
      <ProgressBar value={gem.reserve} funded={gem.funded} />
      {showShortfall && !gem.funded && (
        <div
          className="rounded-[8px] px-3 py-2 text-[12px]"
          style={{ background: 'rgba(229,162,60,.08)', border: '1px solid rgba(229,162,60,.28)', color: '#E5C99A' }}
        >
          Reserve short — top-up of{' '}
          <span className="font-mono font-semibold">{fmtUsd(shortfall)}</span> required before this
          gem can be minted or redeemed.
        </div>
      )}
    </div>
  );
}

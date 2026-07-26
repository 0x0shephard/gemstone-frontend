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
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="font-semibold uppercase tracking-[0.12em] text-ink-muted">
          Reserve health
        </span>
        <span className="font-semibold" style={{ color: gem.reserveColor }}>
          {gem.reserveLabel}
        </span>
      </div>
      <ProgressBar value={gem.reserve} funded={gem.funded} />
      {showShortfall && !gem.funded && (
        <div
          className="rounded-[4px] px-3 py-2.5 text-[11.5px] leading-relaxed"
          style={{
            background: 'rgba(233,173,91,.07)',
            border: '1px solid rgba(233,173,91,.24)',
            color: '#EBCB9E',
          }}
        >
          Reserve short — top-up of{' '}
          <span className="font-mono font-semibold">{fmtUsd(shortfall)}</span> required before this
          gem can be minted or redeemed.
        </div>
      )}
    </div>
  );
}

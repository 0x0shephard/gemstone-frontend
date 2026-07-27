import type { DecoratedGem } from '@/services/types';
import { reserveShortfallUsd } from '@/lib/gem';
import { fmtUsd } from '@/lib/format';

interface PriceBreakdownProps {
  gem: DecoratedGem;
  /** Heading above the headline figure. */
  label?: string;
}

/**
 * What the buyer actually pays.
 *
 * A purchase settles the sale price *and* any reserve shortfall in the same
 * transaction, so showing the valuation alone understates the cost. The total
 * is stated explicitly rather than left for the buyer to add up.
 */
export function PriceBreakdown({ gem, label = 'Expert-approved value' }: PriceBreakdownProps) {
  const shortfall = reserveShortfallUsd(gem);
  const total = gem.value + shortfall;

  return (
    <div>
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.15em] text-ink-dim">
        {label}
      </div>
      <div className="mt-1 font-mono text-[28px] font-semibold tracking-[-0.04em] text-ink sm:text-[32px]">
        {gem.valueFmt}
      </div>

      <dl className="mt-4 space-y-2 border-t border-line/[0.06] pt-4">
        <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
          <dt className="text-ink-muted">Gemstone</dt>
          <dd className="font-mono text-ink-soft">{fmtUsd(gem.value)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
          <dt className="text-ink-muted">Vault reserve top-up</dt>
          <dd className={shortfall > 0 ? 'font-mono text-amber' : 'font-mono text-ink-dim'}>
            {shortfall > 0 ? `+ ${fmtUsd(shortfall)}` : 'None due'}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-line/[0.06] pt-2.5 text-[14px] font-semibold">
          <dt className="text-ink">You pay</dt>
          <dd className="font-mono tracking-[-0.02em] text-ink">{fmtUsd(total)}</dd>
        </div>
      </dl>

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-dim">
        {shortfall > 0
          ? `This gem is ${fmtUsd(shortfall)} below its required reserve, so the purchase tops the reserve up in the same transaction. Anything overpaid is refunded automatically.`
          : 'The reserve is already funded, so you pay the approved valuation only. Anything overpaid is refunded automatically.'}
      </p>
    </div>
  );
}

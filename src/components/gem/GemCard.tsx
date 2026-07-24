import { Link } from 'react-router-dom';
import type { DecoratedGem } from '@/services/types';
import { Card } from '@/components/ui/Card';
import { GemThumb } from './GemThumb';
import { ProgressBar } from '@/components/ui/ProgressBar';

interface GemCardProps {
  gem: DecoratedGem;
  /** Extra overlay on the thumbnail (e.g. countdown badge). */
  thumbOverlay?: React.ReactNode;
  /** CTA label; defaults to "View →". */
  ctaLabel?: string;
  href?: string;
  revealDelay?: number;
}

/** The primary gem card used across marketplace, auctions and featured grids. */
export function GemCard({
  gem,
  thumbOverlay,
  ctaLabel = 'View →',
  href,
  revealDelay,
}: GemCardProps) {
  const to = href ?? `/gem/${gem.gemId}`;
  return (
    <Card
      hoverLift
      as="article"
      data-reveal
      data-reveal-delay={revealDelay}
      className="dc-card-sheen group relative overflow-hidden"
    >
      <Link to={to} aria-label={`Inspect ${gem.name}`} className="absolute inset-0 z-10">
        <span className="sr-only">Inspect {gem.name}</span>
      </Link>
      <GemThumb gem={gem} height={178}>
        {thumbOverlay}
      </GemThumb>
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-display text-[15px] font-medium tracking-[-0.015em] text-ink">
              {gem.name}
            </h3>
            <span className="mt-0.5 block font-mono text-[10.5px] tracking-[0.03em] text-ink-dim">
              {gem.displayId}
            </span>
          </div>
          <span className="mt-0.5 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.025] px-2 py-1 text-[9.5px] uppercase tracking-[0.08em] text-ink-muted">
            {gem.typeLabel}
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-ink-muted">{gem.reserveLabel}</span>
            <span className="text-ink-dim">{gem.feeLabel}</span>
          </div>
          <ProgressBar value={gem.reserve} funded={gem.funded} height={6} />
        </div>

        <div className="flex items-end justify-between border-t border-white/[0.06] pt-3">
          <div>
            <div className="text-[9.5px] font-semibold uppercase tracking-[0.15em] text-ink-dim">
              Approved value
            </div>
            <div className="mt-0.5 font-mono text-[18px] font-semibold tracking-[-0.03em] text-ink">
              {gem.valueFmt}
            </div>
          </div>
          <span className="text-[12px] font-semibold text-ink-muted transition-all group-hover:translate-x-0.5 group-hover:text-ink">
            {ctaLabel}
          </span>
        </div>
      </div>
    </Card>
  );
}

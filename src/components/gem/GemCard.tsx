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
export function GemCard({ gem, thumbOverlay, ctaLabel = 'View →', href, revealDelay }: GemCardProps) {
  const to = href ?? `/gem/${gem.id}`;
  return (
    <Card
      hoverLift
      as="article"
      data-reveal
      data-reveal-delay={revealDelay}
      className="overflow-hidden"
    >
      <GemThumb gem={gem} height={178}>
        {thumbOverlay}
      </GemThumb>
      <div className="space-y-3 p-5">
        <div>
          <h3 className="text-[15.5px] font-semibold text-ink">{gem.name}</h3>
          <span className="font-mono text-[11.5px] text-ink-dim">{gem.gemId}</span>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-ink-muted">{gem.reserveLabel}</span>
            <span className="text-ink-dim">{gem.feeLabel}</span>
          </div>
          <ProgressBar value={gem.reserve} funded={gem.funded} height={6} />
        </div>

        <div className="flex items-end justify-between pt-1">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">Est. value</div>
            <div className="font-mono text-[19px] font-bold text-ink">{gem.valueFmt}</div>
          </div>
          <Link
            to={to}
            className="text-[13px] font-semibold text-ink-soft transition-colors hover:text-ink"
          >
            {ctaLabel}
          </Link>
        </div>
      </div>
    </Card>
  );
}

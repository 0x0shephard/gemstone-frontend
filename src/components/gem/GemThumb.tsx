import type { DecoratedGem } from '@/services/types';
import { cn } from '@/lib/cn';

interface GemThumbProps {
  gem: DecoratedGem;
  /** CSS height; width fills container. */
  height?: number | string;
  rounded?: string;
  showTag?: boolean;
  showCarat?: boolean;
  children?: React.ReactNode;
  className?: string;
}

/** The faux-faceted gem swatch, with optional type tag + carat chip overlays. */
export function GemThumb({
  gem,
  height = 176,
  rounded = 'rounded-[4px]',
  showTag = true,
  showCarat = true,
  children,
  className,
}: GemThumbProps) {
  return (
    <div
      className={cn('relative overflow-hidden', rounded, className)}
      style={{ height, background: gem.thumb }}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(circle at 28% 12%, rgba(255,255,255,.12), transparent 26%), linear-gradient(150deg, transparent 45%, rgba(0,0,0,.28))',
        }}
      />
      {showTag && (
        <span
          className="absolute left-3 top-3 rounded-[4px] px-2 py-1 text-[11px] font-semibold"
          style={{
            color: gem.color,
            background: `${gem.color}1f`,
            border: `1px solid ${gem.color}55`,
          }}
        >
          {gem.typeLabel}
        </span>
      )}
      {showCarat && (
        <span className="absolute right-3 top-3 rounded-[4px] bg-black/40 px-2 py-1 font-mono text-[11px] text-ink-soft backdrop-blur">
          {gem.caratsFmt}
        </span>
      )}
      {children}
    </div>
  );
}

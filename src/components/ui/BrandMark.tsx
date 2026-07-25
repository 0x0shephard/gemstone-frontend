import { cn } from '@/lib/cn';

interface BrandMarkProps {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}

/** The rotated-square brand glyph, optionally with the DIGITAL CARAT wordmark. */
export function BrandMark({ size = 20, withWordmark = true, className }: BrandMarkProps) {
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        style={{ width: size, height: size }}
        className="shrink-0 overflow-visible text-ink-soft"
        fill="none"
      >
        <path d="M12 1.8 22.2 9 18 21H6L1.8 9 12 1.8Z" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="m1.8 9 10.2 3 10.2-3M6 21l6-9 6 9M12 1.8V12"
          stroke="currentColor"
          strokeWidth=".75"
          opacity=".55"
        />
        <path
          d="m6.2 5.9 5.8 6.1 5.8-6.1"
          stroke="var(--dc-accent)"
          strokeWidth=".9"
          opacity=".9"
        />
      </svg>
      {withWordmark && (
        <span className="font-display text-[12px] font-medium tracking-[0.18em] text-ink">
          DIGITAL CARAT
        </span>
      )}
    </span>
  );
}

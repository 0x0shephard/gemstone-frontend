import { useCountdown } from '@/hooks/useCountdown';
import { fmtCountdown } from '@/lib/format';
import { cn } from '@/lib/cn';

interface CountdownBadgeProps {
  seconds: number;
  /** 'overlay' = dark chip over an image; 'inline' = plain amber mono text. */
  variant?: 'overlay' | 'inline';
  className?: string;
}

/** Live countdown, ticking each second; shows "Ended" at zero. */
export function CountdownBadge({ seconds, variant = 'inline', className }: CountdownBadgeProps) {
  const remaining = useCountdown(seconds);
  const label = remaining <= 0 ? 'Ended' : fmtCountdown(remaining);
  const ended = remaining <= 0;

  if (variant === 'overlay') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-[6px] bg-black/50 px-2 py-1 font-mono text-[11px] backdrop-blur',
          ended ? 'text-ink-dim' : 'text-amber',
          className,
        )}
      >
        ⏱ {label}
      </span>
    );
  }

  return (
    <span className={cn('font-mono text-[13px]', ended ? 'text-ink-dim' : 'text-amber', className)}>
      {label}
    </span>
  );
}

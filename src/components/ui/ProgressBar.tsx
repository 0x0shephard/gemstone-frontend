import { cn } from '@/lib/cn';

interface ProgressBarProps {
  /** 0–100+ (clamped to 100 for width). */
  value: number;
  funded?: boolean;
  className?: string;
  height?: number;
}

/** Reserve/progress bar with funded (green) vs short (amber) gradient. */
export function ProgressBar({ value, funded, className, height = 7 }: ProgressBarProps) {
  const isFunded = funded ?? value >= 100;
  const width = Math.min(100, Math.max(0, value));
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-track', className)}
      style={{ height }}
    >
      <div
        className={cn('h-full rounded-full', isFunded ? 'bg-bar-funded' : 'bg-bar-short')}
        style={{ width: `${width}%`, transition: 'width .5s cubic-bezier(.22,.61,.36,1)' }}
      />
    </div>
  );
}

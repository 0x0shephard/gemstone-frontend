import { cn } from '@/lib/cn';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const toneColor: Record<StatusTone, string> = {
  success: 'var(--dc-emerald)',
  warning: 'var(--dc-amber)',
  danger: 'var(--dc-ruby)',
  info: 'var(--dc-sapphire)',
  neutral: '#929BA8',
};

interface StatusBadgeProps {
  tone?: StatusTone;
  /** Override the accent color directly (e.g. from data). */
  color?: string;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

/** Small colored status pill (green/amber/red/blue/grey triad + info). */
export function StatusBadge({ tone = 'neutral', color, dot, children, className }: StatusBadgeProps) {
  const c = color ?? toneColor[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[7px] px-[11px] py-[5px] text-[11.5px] font-semibold',
        className,
      )}
      style={{
        color: c,
        background: `color-mix(in srgb, ${c} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 23%, transparent)`,
      }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />}
      {children}
    </span>
  );
}

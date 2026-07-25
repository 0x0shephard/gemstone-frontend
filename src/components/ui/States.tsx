import { cn } from '@/lib/cn';

/** Shimmer skeleton block. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-[16px] border border-white/[0.045] bg-gradient-to-br from-white/[0.05] to-white/[0.015]',
        className,
      )}
    />
  );
}

/** A grid of gem-card skeletons for loading states. */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[320px]" />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, hint, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'dc-dot-grid flex min-h-[260px] flex-col items-center justify-center rounded-[18px] border border-dashed border-white/[0.11] px-6 py-16 text-center',
        className,
      )}
    >
      <div
        className="relative mb-4 h-10 w-10 rotate-45 rounded-[9px] border border-atelier/30 bg-atelier/[0.06]"
        aria-hidden
      >
        <span className="absolute inset-[9px] rounded-[4px] border border-white/[0.12]" />
      </div>
      <h3 className="font-display text-[16px] font-medium text-ink">{title}</h3>
      {hint && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message?: string }) {
  return (
    <div className="rounded-[18px] border border-ruby/30 bg-ruby/[0.07] px-6 py-10 text-center text-[13px] text-ruby">
      {message ?? 'Something went wrong loading this data.'}
    </div>
  );
}

import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

interface BackToHomeLinkProps {
  compact?: boolean;
  className?: string;
}

/** Direct route to the public landing page; independent of browser history. */
export function BackToHomeLink({ compact = false, className }: BackToHomeLinkProps) {
  return (
    <Link
      to="/"
      aria-label="Back to home"
      className={cn(
        'group inline-flex h-10 items-center justify-center gap-2 rounded-[11px] border border-white/[0.1] bg-white/[0.025] text-[12px] font-semibold text-ink-muted transition-colors hover:border-white/[0.2] hover:bg-white/[0.055] hover:text-ink',
        compact ? 'w-10 px-0 lg:w-auto lg:px-3' : 'px-3.5',
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="h-4 w-4 shrink-0 transition-transform group-hover:-translate-x-0.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m11.5 5-5 5 5 5" />
        <path d="M7 10h7" />
      </svg>
      <span className={cn(compact && 'hidden lg:inline')}>Back to home</span>
    </Link>
  );
}

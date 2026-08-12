import { cn } from '@/lib/cn';

interface FilterPillsProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

export function FilterPills<T extends string>({ options, value, onChange }: FilterPillsProps<T>) {
  return (
    /*
      A single scrolling row on phones. Thirteen varieties wrap to four lines at
      390px, which costs over a hundred vertical pixels before any gemstone is
      on screen; from `sm` up there is width to wrap and scrolling would be the
      worse trade.
    */
    <div className="dc-scroll-x -mx-1 flex gap-1.5 overflow-x-auto rounded-[4px] border border-line/[0.07] bg-line/[0.02] p-1 sm:mx-0 sm:flex-wrap sm:overflow-visible">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-[4px] border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors',
              active
                ? 'border-line/[0.09] bg-line/[0.08] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.05)]'
                : 'border-transparent bg-transparent text-ink-muted hover:bg-line/[0.03] hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

import { cn } from '@/lib/cn';

interface FilterPillsProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

export function FilterPills<T extends string>({ options, value, onChange }: FilterPillsProps<T>) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-[12px] border border-white/[0.07] bg-white/[0.02] p-1">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              'rounded-[9px] border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors',
              active
                ? 'border-white/[0.09] bg-white/[0.08] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.05)]'
                : 'border-transparent bg-transparent text-ink-muted hover:bg-white/[0.03] hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

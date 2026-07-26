import { cn } from '@/lib/cn';

export interface TabDef<T extends string> {
  key: T;
  label: string;
  count?: string | number;
}

interface TabsProps<T extends string> {
  tabs: TabDef<T>[];
  value: T;
  onChange: (key: T) => void;
}

export function Tabs<T extends string>({ tabs, value, onChange }: TabsProps<T>) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-[4px] border border-white/[0.07] bg-white/[0.02] p-1">
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={cn(
              'inline-flex items-center gap-2 whitespace-nowrap rounded-[4px] border px-[15px] py-[8px] text-[13px] transition-colors',
              active
                ? 'border-white/[0.09] bg-white/[0.085] font-semibold text-ink'
                : 'border-transparent bg-transparent font-medium text-ink-muted hover:bg-white/[0.025] hover:text-ink',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={cn(
                  'rounded-[4px] px-1.5 py-0.5 font-mono text-[10.5px]',
                  active ? 'bg-atelier/15 text-atelier' : 'bg-white/[0.05] text-ink-muted',
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

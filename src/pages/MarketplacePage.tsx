import { useMemo, useState } from 'react';
import { useListings } from '@/hooks/useData';
import { GemCard } from '@/components/gem/GemCard';
import { FilterPills } from '@/components/ui/FilterPills';
import { CardGridSkeleton, ErrorState, EmptyState } from '@/components/ui/States';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import type { GemType } from '@/services/types';

type Filter = 'all' | GemType;
type Sort = 'value-desc' | 'value-asc' | 'reserve';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'sapphire', label: 'Sapphire' },
  { value: 'emerald', label: 'Emerald' },
];

export default function MarketplacePage() {
  const { data: gems, isLoading, isError } = useListings();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('value-desc');

  const visible = useMemo(() => {
    let list = gems ?? [];
    if (filter !== 'all') list = list.filter((g) => g.type === filter);
    const sorted = [...list];
    if (sort === 'value-desc') sorted.sort((a, b) => b.value - a.value);
    if (sort === 'value-asc') sorted.sort((a, b) => a.value - b.value);
    if (sort === 'reserve') sorted.sort((a, b) => a.reserve - b.reserve);
    return sorted;
  }, [gems, filter, sort]);

  useScrollReveal([visible]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterPills options={FILTERS} value={filter} onChange={setFilter} />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="h-9 rounded-[9px] border border-white/[0.08] bg-card px-3 text-[13px] text-ink-soft outline-none"
        >
          <option value="value-desc">Value: high → low</option>
          <option value="value-asc">Value: low → high</option>
          <option value="reserve">Reserve: lowest first</option>
        </select>
      </div>

      {isLoading ? (
        <CardGridSkeleton />
      ) : isError ? (
        <ErrorState />
      ) : visible.length === 0 ? (
        <EmptyState title="No gems match" hint="Try a different filter." />
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {visible.map((gem, i) => (
            <GemCard key={gem.id} gem={gem} revealDelay={(i % 4) * 60} />
          ))}
        </div>
      )}
    </div>
  );
}

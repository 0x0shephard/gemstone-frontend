import { useMemo, useState } from 'react';
import { useListings } from '@/hooks/useData';
import { GemCard } from '@/components/gem/GemCard';
import { FilterPills } from '@/components/ui/FilterPills';
import { CardGridSkeleton, ErrorState, EmptyState } from '@/components/ui/States';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import type { GemType } from '@/services/types';

type Filter = 'all' | GemType;
type Sort = 'value-desc' | 'value-asc' | 'reserve';

export default function MarketplacePage() {
  const { data: gems, isLoading, isError } = useListings();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('value-desc');
  const [search, setSearch] = useState('');
  const filters = useMemo(
    () => [
      { value: 'all', label: 'All' },
      ...[...new Map((gems ?? []).map((gem) => [gem.type, gem.typeLabel])).entries()].map(
        ([value, label]) => ({ value, label }),
      ),
    ],
    [gems],
  );

  const visible = useMemo(() => {
    let list = gems ?? [];
    if (filter !== 'all') list = list.filter((g) => g.type === filter);
    const query = search.trim().toLowerCase();
    if (query) {
      list = list.filter((gem) =>
        [gem.name, gem.displayId, gem.typeLabel, gem.custodyCountry, gem.custodyProvider].some(
          (value) => value.toLowerCase().includes(query),
        ),
      );
    }
    const sorted = [...list];
    if (sort === 'value-desc') sorted.sort((a, b) => b.value - a.value);
    if (sort === 'value-asc') sorted.sort((a, b) => a.value - b.value);
    if (sort === 'reserve') sorted.sort((a, b) => a.reserve - b.reserve);
    return sorted;
  }, [gems, filter, search, sort]);

  useScrollReveal([visible]);

  return (
    <div className="space-y-7">
      <section className="relative overflow-hidden rounded-[4px] border border-line/[0.08] bg-gradient-to-br from-card to-inset px-5 py-5 sm:px-7 sm:py-8">
        <div className="dc-dot-grid pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-45" />
        <div className="relative flex flex-col justify-between gap-4 lg:flex-row lg:items-end lg:gap-6">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-atelier">
                Vault inventory
              </p>
              {/* Same figure as the block below, folded onto the eyebrow line so
                  a phone does not spend a whole row on it. */}
              <p className="font-mono text-[12px] text-ink-dim lg:hidden">
                {isLoading ? '—' : `${visible.length} stones`}
              </p>
            </div>
            <h2 className="mt-2 max-w-xl font-display text-[25px] font-medium leading-tight tracking-[-0.035em] text-ink sm:text-[31px]">
              Find the gemstones you want to invest into.
            </h2>
            <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
              Compare gemstone values with a gemological valuation matrix.
            </p>
          </div>
          <div className="hidden shrink-0 text-left lg:block lg:text-right">
            <div className="font-mono text-[22px] font-medium text-ink">
              {isLoading ? '—' : visible.length}
            </div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-ink-dim">
              matching stones
            </div>
          </div>
        </div>
      </section>

      {/*
        Search and sort share a row; the varieties get their own beneath.

        All three were one row, and flexbox resolved it badly: `flex-1` is
        `flex: 1 1 0%`, so the search began at zero width and grew only into
        space left over, while the pills carried `flex-basis: auto` and claimed
        their content width first. Past a handful of varieties nothing was left
        over, the input collapsed to nothing, and its absolutely positioned icon
        went on rendering — a magnifier sitting on top of the first pill.
      */}
      <div className="space-y-3 rounded-[4px] border border-line/[0.07] bg-line/[0.018] p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search marketplace</span>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-dim"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <circle cx="10.5" cy="10.5" r="6" />
              <path d="m15 15 4 4" />
            </svg>
            {/* A floor as well as a share, so it can never be squeezed away. */}
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, gemstone type, origin or ID"
              className="h-11 w-full min-w-[12rem] rounded-[4px] border border-line/[0.09] bg-inset pl-10 pr-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-dim focus:border-atelier/45"
            />
          </label>
          <select
            aria-label="Sort marketplace listings"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-11 shrink-0 rounded-[4px] border border-line/[0.09] bg-inset px-3 text-[12.5px] text-ink-soft outline-none focus:border-atelier/45"
          >
            <option value="value-desc">Value · high to low</option>
            <option value="value-asc">Value · low to high</option>
            <option value="reserve">Reserve · needs funding</option>
          </select>
        </div>
        <FilterPills options={filters} value={filter} onChange={setFilter} />
      </div>

      {isLoading ? (
        <CardGridSkeleton />
      ) : isError ? (
        <ErrorState />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No stones match this view"
          hint="Clear the search or choose another gemstone type."
        />
      ) : (
        <div className="grid gap-4 sm:gap-5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {visible.map((gem, i) => (
            <GemCard
              key={gem.gemId.toString()}
              gem={gem}
              href={`/gem/${gem.gemId}?market=${gem.market ?? 'secondary'}`}
              ctaLabel={gem.market === 'primary' ? 'Buy now →' : 'Purchase →'}
              revealDelay={(i % 4) * 60}
            />
          ))}
        </div>
      )}
    </div>
  );
}

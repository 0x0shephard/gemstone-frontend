import { useState } from 'react';
import { useSwaps, useGems } from '@/hooks/useData';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { GemThumb } from '@/components/gem/GemThumb';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TxButton } from '@/components/tx/TxButton';
import { Skeleton, ErrorState, EmptyState } from '@/components/ui/States';
import { GemActionModals } from '@/components/modals/GemActionModals';
import { useGemModals } from '@/hooks/useGemModals';
import { dataService } from '@/services';
import { inputClass } from '@/components/ui/Field';

export default function SwapsPage() {
  const { data: swaps, isLoading, isError } = useSwaps();
  const { data: gems = [] } = useGems();
  const modals = useGemModals();
  const [offeredId, setOfferedId] = useState('');
  const offered = gems.find((g) => g.id === offeredId);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      {/* Propose */}
      <Card className="h-fit p-6">
        <h3 className="text-[16px] font-semibold text-ink">Propose a swap</h3>
        <p className="mt-1 text-[13px] text-ink-muted">
          Offer one of your gems in exchange for another, with an optional cash delta.
        </p>
        <div className="mt-5 space-y-2">
          <span className="block text-[12px] font-medium text-ink-muted">Gem you offer</span>
          <select
            className={inputClass}
            value={offeredId}
            onChange={(e) => setOfferedId(e.target.value)}
          >
            <option value="">Select an owned gem…</option>
            {gems.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · {g.gemId}
              </option>
            ))}
          </select>
        </div>
        <Button
          className="mt-4"
          block
          disabled={!offered}
          onClick={() => offered && modals.open('swap', offered)}
        >
          Continue
        </Button>
      </Card>

      {/* Open requests */}
      <div className="space-y-4">
        <h3 className="text-[16px] font-semibold text-ink">Open swap requests</h3>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : isError ? (
          <ErrorState />
        ) : !swaps || swaps.length === 0 ? (
          <EmptyState title="No open swaps" hint="Propose one to get started." />
        ) : (
          swaps.map((s, i) => (
            <Card key={i} className="p-5">
              <div className="flex items-center gap-4">
                <div className="flex flex-1 items-center gap-3">
                  <GemThumb gem={s.gem} height={52} rounded="rounded-[10px]" showTag={false} showCarat={false} className="w-[52px]" />
                  <div>
                    <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-dim">You receive</div>
                    <div className="text-[14px] font-semibold text-ink">{s.gem.name}</div>
                    <div className="font-mono text-[11.5px] text-ink-dim">{s.gem.gemId}</div>
                  </div>
                </div>
                <span className="text-[20px] text-ink-dim">⇄</span>
                <div className="flex-1">
                  <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-dim">You give</div>
                  <div className="text-[14px] font-semibold text-ink">{s.giveName}</div>
                  <div className="font-mono text-[11.5px] text-ink-dim">{s.giveId}</div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StatusBadge color={s.statusColor} dot>
                    {s.status}
                  </StatusBadge>
                  <span className="text-[13px] font-medium text-emerald">{s.diff}</span>
                </div>
                <TxButton
                  size="sm"
                  action={() => dataService.acceptSwap(s.gem.id)}
                  pendingLabel="Accepting…"
                >
                  Accept swap
                </TxButton>
              </div>
            </Card>
          ))
        )}
      </div>

      <GemActionModals state={modals.state} onClose={modals.close} />
    </div>
  );
}

import { useState } from 'react';
import { useProfile, useSwaps } from '@/hooks/useData';
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
import { useAccount } from 'wagmi';

export default function SwapsPage() {
  const { data: swaps, isLoading, isError } = useSwaps();
  const { address } = useAccount();
  const { data: profile } = useProfile(address);
  const ownedGems = (profile?.owned ?? []).filter((gem) => !gem.listingSeller);
  const modals = useGemModals();
  const [offeredId, setOfferedId] = useState('');
  const offered = ownedGems.find((g) => g.gemId.toString() === offeredId);

  return (
    <div className="grid gap-6 xl:grid-cols-[.82fr_1.4fr]">
      {/* Propose */}
      <Card className="dc-facet-border h-fit overflow-hidden p-5 sm:p-6">
        <div className="mb-4 h-px w-8 bg-atelier" />
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.15em] text-ink-dim">
          New exchange
        </p>
        <h3 className="mt-1.5 font-display text-[20px] font-medium tracking-[-0.025em] text-ink">
          Propose a swap
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          Offer one of your gems in exchange for another, with an optional cash delta.
        </p>
        <div className="mt-5 space-y-2">
          <span className="block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
            Gem you offer
          </span>
          <select
            className={inputClass}
            value={offeredId}
            onChange={(e) => setOfferedId(e.target.value)}
          >
            <option value="">Select an owned gem…</option>
            {ownedGems.map((g) => (
              <option key={g.gemId.toString()} value={g.gemId.toString()}>
                {g.name} · {g.displayId}
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
          Build swap offer
        </Button>
      </Card>

      {/* Open requests */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-[17px] font-medium text-ink">Open swap requests</h3>
          <span className="font-mono text-[11px] text-ink-dim">{swaps?.length ?? 0} active</span>
        </div>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : isError ? (
          <ErrorState />
        ) : !swaps || swaps.length === 0 ? (
          <EmptyState title="No open swaps" hint="Propose one to get started." />
        ) : (
          swaps.map((s) => {
            const canCancel = address?.toLowerCase() === s.proposer.toLowerCase();
            const canAccept = address?.toLowerCase() === s.requestedOwner.toLowerCase();
            return (
              <Card key={s.offerId.toString()} className="p-4 sm:p-5">
                <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <GemThumb
                      gem={s.gem}
                      height={52}
                      rounded="rounded-[4px]"
                      showTag={false}
                      showCarat={false}
                      className="w-[52px]"
                    />
                    <div>
                      <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-dim">
                        You receive
                      </div>
                      <div className="text-[14px] font-semibold text-ink">{s.gem.name}</div>
                      <div className="font-mono text-[11.5px] text-ink-dim">{s.gem.displayId}</div>
                    </div>
                  </div>
                  <span className="hidden text-[20px] text-ink-dim sm:block">⇄</span>
                  <div className="min-w-0 border-l border-line/[0.07] pl-4 sm:border-0 sm:pl-0">
                    <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-dim">
                      You give
                    </div>
                    <div className="text-[14px] font-semibold text-ink">{s.giveName}</div>
                    <div className="font-mono text-[11.5px] text-ink-dim">{s.giveDisplayId}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-3 border-t border-line/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge color={s.statusColor} dot>
                      {s.status}
                    </StatusBadge>
                    <span className="text-[13px] font-medium text-emerald">{s.diff}</span>
                  </div>
                  {(canCancel || canAccept) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {canCancel && (
                        <TxButton
                          size="sm"
                          variant="ghost"
                          action={() => dataService.cancelSwap({ offerId: s.offerId })}
                          pendingLabel="Cancelling…"
                          telemetryFlow="swap_cancel"
                        >
                          Cancel
                        </TxButton>
                      )}
                      {canAccept && (
                        <TxButton
                          size="sm"
                          action={() => dataService.acceptSwap({ offerId: s.offerId })}
                          pendingLabel="Accepting…"
                          telemetryFlow="swap_accept"
                        >
                          Accept swap
                        </TxButton>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>

      <GemActionModals state={modals.state} onClose={modals.close} />
    </div>
  );
}

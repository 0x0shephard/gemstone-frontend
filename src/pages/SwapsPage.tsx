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
import { explorerAddressUrl } from '@/config/chains';
import { shortenAddress } from '@/lib/format';
import type { SwapRequest } from '@/services/types';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { groupActionableSwaps } from '@/services/chain/marketPresentation';

/*
 * Named for what the swap is waiting on rather than for the contract's internal
 * flag. "Active" told a reader nothing about whose move it was; a swap sits
 * unaccepted until the requested owner acts, and that is the whole state.
 *
 * "Rejected" is only ever reached by the proposer withdrawing: `SwapEscrow`
 * gives the counterparty no reject call, only `cancelOffer`, which is
 * proposer-only. Ignoring an offer until it expires is the only refusal
 * available to them.
 */
const SWAP_STATUS_LABEL: Record<SwapRequest['status'], string> = {
  Active: 'Pending confirmation',
  Accepted: 'Confirmed',
  Cancelled: 'Rejected',
  Expired: 'Expired',
};

/**
 * One half of a swap, attributed to the account that holds it.
 *
 * The previous labels were "You receive" and "You give", which are only true
 * for one of the two parties and were shown to everyone — a proposer reading
 * their own offer was told they would receive the token they were giving away.
 */
function SwapSide({
  role,
  account,
  name,
  displayId,
}: {
  role: string;
  account: Address;
  name: string;
  displayId: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-dim">
        {role}{' '}
        <a
          href={explorerAddressUrl(account)}
          target="_blank"
          rel="noreferrer"
          className="font-mono normal-case tracking-normal text-ink-muted underline decoration-line/30 underline-offset-2 hover:text-ink"
        >
          {shortenAddress(account)}
        </a>
      </div>
      <div className="mt-0.5 truncate text-[14px] font-semibold text-ink">{name}</div>
      <div className="font-mono text-[11.5px] text-ink-dim">{displayId}</div>
    </div>
  );
}

function SwapCard({ swap, viewer }: { swap: SwapRequest; viewer?: Address }) {
  const canCancel = viewer?.toLowerCase() === swap.proposer.toLowerCase();
  const canAccept =
    swap.status === 'Active' && viewer?.toLowerCase() === swap.requestedOwner.toLowerCase();

  return (
    <Card className="p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <SwapSide
          role="Offered by"
          account={swap.proposer}
          name={swap.giveName}
          displayId={swap.giveDisplayId}
        />
        <span className="hidden text-[20px] text-ink-dim sm:block">⇄</span>
        <div className="flex min-w-0 items-center gap-3 border-l border-line/[0.07] pl-4 sm:border-0 sm:pl-0">
          <GemThumb
            gem={swap.gem}
            height={52}
            rounded="rounded-[4px]"
            showTag={false}
            showCarat={false}
            className="w-[52px] shrink-0"
          />
          <SwapSide
            role="Requested from"
            account={swap.requestedOwner}
            name={swap.gem.name}
            displayId={swap.gem.displayId}
          />
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3 border-t border-line/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge color={swap.statusColor} dot={swap.status === 'Active'}>
              {SWAP_STATUS_LABEL[swap.status]}
            </StatusBadge>
            <span className="text-[13px] font-medium text-emerald">{swap.diff}</span>
          </div>
          {swap.status === 'Expired' && (
            <p className="mt-2 max-w-md text-[11.5px] leading-relaxed text-ink-muted">
              This offer expired, but the escrow still holds your offered gemstone. Cancel it to
              return the gemstone to your wallet.
            </p>
          )}
        </div>
        {(canCancel || canAccept) && (
          <div className="flex flex-wrap items-center gap-2">
            {canCancel && (
              <TxButton
                size="sm"
                variant="ghost"
                action={() => dataService.cancelSwap({ offerId: swap.offerId })}
                pendingLabel="Cancelling…"
                telemetryFlow="swap_cancel"
              >
                {swap.status === 'Expired' ? 'Return my gemstone' : 'Cancel'}
              </TxButton>
            )}
            {canAccept && (
              <TxButton
                size="sm"
                action={() => dataService.acceptSwap({ offerId: swap.offerId })}
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
}

export default function SwapsPage() {
  const { data: swaps, isLoading, isError } = useSwaps();
  const { address } = useAccount();
  const { data: profile } = useProfile(address);
  const ownedGems = (profile?.owned ?? []).filter((gem) => !gem.listingSeller);
  const modals = useGemModals();
  const [offeredId, setOfferedId] = useState('');
  const offered = ownedGems.find((g) => g.gemId.toString() === offeredId);
  const { active: activeSwaps, expiredOwned } = groupActionableSwaps(swaps ?? [], address);

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
          <span className="font-mono text-[11px] text-ink-dim">{activeSwaps.length} active</span>
        </div>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : isError ? (
          <ErrorState />
        ) : activeSwaps.length === 0 ? (
          <EmptyState title="No open swaps" hint="Propose one to get started." />
        ) : (
          activeSwaps.map((swap) => (
            <SwapCard key={swap.offerId.toString()} swap={swap} viewer={address} />
          ))
        )}

        {!isLoading && !isError && expiredOwned.length > 0 && (
          <section className="space-y-3 pt-3" aria-labelledby="expired-swaps-heading">
            <div>
              <h3
                id="expired-swaps-heading"
                className="font-display text-[17px] font-medium text-ink"
              >
                Expired swaps to clear
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                These are not open offers. Cancel them to release your escrowed gemstones.
              </p>
            </div>
            {expiredOwned.map((swap) => (
              <SwapCard key={swap.offerId.toString()} swap={swap} viewer={address} />
            ))}
          </section>
        )}
      </div>

      <GemActionModals state={modals.state} onClose={modals.close} />
    </div>
  );
}

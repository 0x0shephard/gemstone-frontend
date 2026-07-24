import { useAuctions, usePendingAuctionRefunds } from '@/hooks/useData';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { GemThumb } from '@/components/gem/GemThumb';
import { CountdownBadge } from '@/components/ui/CountdownBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TxButton } from '@/components/tx/TxButton';
import { CardGridSkeleton, ErrorState, EmptyState } from '@/components/ui/States';
import { GemActionModals } from '@/components/modals/GemActionModals';
import { useGemModals } from '@/hooks/useGemModals';
import { dataService } from '@/services';
import { fmtUsd } from '@/lib/format';
import { useAccount } from 'wagmi';

export default function AuctionsPage() {
  const { data: auctions, isLoading, isError } = useAuctions();
  const { address } = useAccount();
  const { data: pendingRefunds = [] } = usePendingAuctionRefunds(address);
  const modals = useGemModals();

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[20px] border border-white/[0.08] bg-gradient-to-br from-card to-inset p-5 sm:p-6">
        <div className="dc-dot-grid pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-35" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-atelier">
              24-hour primary market
            </p>
            <h2 className="mt-2 font-display text-[23px] font-medium tracking-[-0.03em] text-ink">
              Bid once. Track the leader. Settle on-chain.
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
              Outbid funds become claimable refunds. Settlement rechecks reserve health before the
              stone transfers.
            </p>
          </div>
          <div className="shrink-0">
            <div className="font-mono text-[22px] font-medium text-ink">
              {auctions?.length ?? 0}
            </div>
            <div className="text-[9.5px] uppercase tracking-[0.14em] text-ink-dim">
              live auctions
            </div>
          </div>
        </div>
      </section>

      {isLoading ? (
        <CardGridSkeleton count={3} />
      ) : isError ? (
        <ErrorState />
      ) : !auctions || auctions.length === 0 ? (
        <EmptyState title="No live auctions" hint="Check back soon." />
      ) : (
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {auctions.map((a) => {
            const expired = a.secondsLeft <= 0;
            return (
              <Card
                key={a.gem.gemId.toString()}
                hoverLift
                className="dc-card-sheen relative overflow-hidden"
              >
                <GemThumb gem={a.gem} height={190}>
                  <span className="absolute bottom-3 left-3">
                    <CountdownBadge seconds={a.secondsLeft} variant="overlay" />
                  </span>
                </GemThumb>
                <div className="space-y-4 p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-display text-[15px] font-medium text-ink">
                        {a.gem.name}
                      </h3>
                      <span className="font-mono text-[11.5px] text-ink-dim">
                        {a.gem.displayId}
                      </span>
                    </div>
                    {a.gem.funded ? (
                      <StatusBadge tone="success" dot>
                        Funded
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="warning" dot>
                        Reserve short
                      </StatusBadge>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-white/[0.06] bg-white/[0.06] text-[12px]">
                    <div className="bg-card p-3">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-dim">
                        Highest bid
                      </div>
                      <div className="mt-1 font-mono text-[16px] font-semibold text-ink">
                        {a.highestBidFmt}
                      </div>
                    </div>
                    <div className="bg-card p-3">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-dim">
                        Floor
                      </div>
                      <div className="mt-1 font-mono text-[16px] font-semibold text-ink-soft">
                        {fmtUsd(Number(a.floorUsd / 10n ** 18n))}
                      </div>
                    </div>
                    <div className="bg-card p-3">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-dim">
                        Bids
                      </div>
                      <div className="mt-1 font-mono text-[14px] text-ink-soft">{a.bids}</div>
                    </div>
                    <div className="bg-card p-3">
                      <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-dim">
                        Time left
                      </div>
                      <CountdownBadge seconds={a.secondsLeft} />
                    </div>
                  </div>

                  {expired ? (
                    <TxButton
                      block
                      variant="secondary"
                      action={() => dataService.settleAuction({ gemId: a.gem.gemId })}
                      pendingLabel="Settling…"
                    >
                      Settle auction
                    </TxButton>
                  ) : (
                    <Button block onClick={() => modals.open('bid', a.gem)}>
                      Place bid
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {pendingRefunds.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-[12px] text-ink-muted">Pending auction refunds:</span>
          {pendingRefunds.map((refund) => (
            <TxButton
              key={refund.paymentAsset}
              variant="ghost"
              size="sm"
              action={() => dataService.claimRefund({ paymentAsset: refund.paymentAsset })}
              pendingLabel="Claiming…"
              telemetryFlow="auction_refund"
            >
              Claim {refund.amountFmt}
            </TxButton>
          ))}
        </div>
      )}

      <GemActionModals state={modals.state} onClose={modals.close} />
    </div>
  );
}

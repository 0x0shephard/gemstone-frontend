import { useAuctions } from '@/hooks/useData';
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
import { NATIVE_ASSET } from '@/config/contracts';

export default function AuctionsPage() {
  const { data: auctions, isLoading, isError } = useAuctions();
  const modals = useGemModals();

  return (
    <div className="space-y-6">
      <div
        className="flex items-start gap-3 rounded-[12px] px-4 py-3 text-[13px]"
        style={{ background: 'rgba(91,141,239,.06)', border: '1px solid rgba(91,141,239,.24)', color: '#AEC5F5' }}
      >
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sapphire" />
        <span>
          Primary auctions run for 24 hours and settle automatically on expiry. If a gem&apos;s
          reserve is short at settlement, a top-up is required before the sale can finalize.
        </span>
      </div>

      {isLoading ? (
        <CardGridSkeleton count={3} />
      ) : isError ? (
        <ErrorState />
      ) : !auctions || auctions.length === 0 ? (
        <EmptyState title="No live auctions" hint="Check back soon." />
      ) : (
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
          {auctions.map((a) => {
            const expired = a.secondsLeft <= 0;
            return (
              <Card key={a.gem.id} hoverLift className="overflow-hidden">
                <GemThumb gem={a.gem} height={190}>
                  <span className="absolute bottom-3 left-3">
                    <CountdownBadge seconds={a.secondsLeft} variant="overlay" />
                  </span>
                </GemThumb>
                <div className="space-y-4 p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-[15.5px] font-semibold text-ink">{a.gem.name}</h3>
                      <span className="font-mono text-[11.5px] text-ink-dim">{a.gem.gemId}</span>
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

                  <div className="grid grid-cols-2 gap-3 text-[12px]">
                    <div>
                      <div className="uppercase tracking-[0.1em] text-ink-dim">Highest bid</div>
                      <div className="font-mono text-[16px] font-bold text-ink">{a.highestBidFmt}</div>
                    </div>
                    <div>
                      <div className="uppercase tracking-[0.1em] text-ink-dim">Floor</div>
                      <div className="font-mono text-[16px] font-semibold text-ink-soft">
                        {fmtUsd(a.floorUsd)}
                      </div>
                    </div>
                    <div>
                      <div className="uppercase tracking-[0.1em] text-ink-dim">Bids</div>
                      <div className="font-mono text-[14px] text-ink-soft">{a.bids}</div>
                    </div>
                    <div>
                      <div className="uppercase tracking-[0.1em] text-ink-dim">Time left</div>
                      <CountdownBadge seconds={a.secondsLeft} />
                    </div>
                  </div>

                  {expired ? (
                    <TxButton
                      block
                      variant="secondary"
                      action={() => dataService.settleAuction(a.gem.id)}
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

      <div className="flex justify-end">
        <TxButton
          variant="ghost"
          size="sm"
          action={() => dataService.claimRefund(NATIVE_ASSET)}
          pendingLabel="Claiming…"
        >
          Claim outbid refunds
        </TxButton>
      </div>

      <GemActionModals state={modals.state} onClose={modals.close} />
    </div>
  );
}

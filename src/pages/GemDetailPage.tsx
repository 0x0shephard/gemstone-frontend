import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useGem } from '@/hooks/useData';
import { GemThumb } from '@/components/gem/GemThumb';
import { StatTile } from '@/components/ui/StatTile';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ReserveStatus } from '@/components/gem/ReserveStatus';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton, ErrorState } from '@/components/ui/States';
import { GemActionModals } from '@/components/modals/GemActionModals';
import { useGemModals } from '@/hooks/useGemModals';
import { fmtUsd } from '@/lib/format';
import { reserveShortfallUsd } from '@/lib/gem';
import { TxButton } from '@/components/tx/TxButton';
import { dataService } from '@/services';

export default function GemDetailPage() {
  const { gemId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { data: gem, isLoading, isError } = useGem(gemId);
  const modals = useGemModals();
  const isSecondaryListing = searchParams.get('market') === 'secondary';
  const isManageView = searchParams.get('manage') === '1';

  if (isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[460px]" />
        <Skeleton className="h-[460px]" />
      </div>
    );
  }
  if (isError || !gem) return <ErrorState message="Gem not found." />;

  const shortfall = reserveShortfallUsd(gem);

  const specs: [string, React.ReactNode][] = [
    ['Gem ID', <span className="font-mono">{gem.displayId}</span>],
    ['Type', gem.typeLabel],
    ['Carat', gem.caratsFmt],
    ['Custody', gem.custodyLabel],
    ['Market fee', gem.feeLabel],
    ['Redemption', gem.redeem],
  ];

  return (
    <div className="space-y-6">
      <Link
        to="/marketplace"
        className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted hover:text-ink"
      >
        <span aria-hidden>←</span> Vault inventory
      </Link>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
        {/* Left: visual + stats */}
        <div className="space-y-4">
          <div className="dc-facet-border overflow-hidden rounded-[24px] border border-white/[0.09] bg-card">
            <GemThumb gem={gem} height={440} rounded="rounded-[24px]" showTag showCarat />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Carat" value={gem.carats.toFixed(2)} />
            <StatTile
              label="Custody"
              value={<span className="text-[15px]">{gem.custodyCountry}</span>}
            />
            <StatTile label="Secondary fee" value={`${gem.feePct.toFixed(1)}%`} />
          </div>
        </div>

        {/* Right: pricing + actions */}
        <div className="space-y-5">
          <div className="pt-1">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge color={gem.color}>{gem.typeLabel}</StatusBadge>
              {gem.funded ? (
                <StatusBadge tone="success" dot>
                  Funded
                </StatusBadge>
              ) : (
                <StatusBadge tone="warning" dot>
                  Reserve short
                </StatusBadge>
              )}
              {gem.redeem === 'KYC required' && (
                <StatusBadge tone="danger">KYC required</StatusBadge>
              )}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.13em] text-ink-dim">
              {gem.displayId}
            </div>
            <h1 className="mt-2 font-display text-[30px] font-medium leading-tight tracking-[-0.04em] text-ink sm:text-[36px]">
              {gem.name}
            </h1>
          </div>

          <Card className="dc-facet-border p-5 sm:p-6">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.15em] text-ink-dim">
                  Expert-approved value
                </div>
                <div className="mt-1 font-mono text-[28px] font-semibold tracking-[-0.04em] text-ink sm:text-[32px]">
                  {gem.valueFmt}
                </div>
              </div>
              {shortfall > 0 && (
                <div className="text-right">
                  <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
                    Buyer reserve charge
                  </div>
                  <div className="font-mono text-[16px] font-semibold text-amber">
                    {fmtUsd(shortfall)}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4">
              <ReserveStatus gem={gem} />
            </div>

            <div className="mt-5 border-t border-white/[0.06] pt-5">
              <div className="mb-3 text-[9.5px] font-semibold uppercase tracking-[0.15em] text-ink-dim">
                {isManageView ? 'Ownership actions' : 'Available actions'}
              </div>
              {isManageView ? (
                <div className="grid grid-cols-2 gap-2.5">
                  <Button onClick={() => modals.open('list', gem)} disabled={!gem.tokenId}>
                    List for sale
                  </Button>
                  <TxButton
                    variant="secondary"
                    disabled={!gem.tokenId}
                    action={() => dataService.cancelListing({ tokenId: gem.tokenId! })}
                    pendingLabel="Cancelling…"
                    telemetryFlow="cancel_listing"
                  >
                    Cancel listing
                  </TxButton>
                  <Button variant="secondary" onClick={() => modals.open('swap', gem)}>
                    Propose swap
                  </Button>
                  {!gem.funded && (
                    <Button variant="secondary" onClick={() => modals.open('reserve', gem)}>
                      Fund reserve
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="col-span-2"
                    onClick={() => modals.open('redeem', gem)}
                  >
                    Redeem physical gemstone
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  <Button
                    onClick={() => modals.open(isSecondaryListing ? 'buy' : 'buyNow', gem)}
                    disabled={isSecondaryListing && !gem.tokenId}
                  >
                    {isSecondaryListing ? 'Purchase listing' : 'Buy now'}
                  </Button>
                  {!isSecondaryListing && (
                    <Button variant="secondary" onClick={() => modals.open('bid', gem)}>
                      Place bid
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => modals.open('offer', gem)}>
                    Make offer
                  </Button>
                  <Button variant="secondary" onClick={() => modals.open('swap', gem)}>
                    Offer swap
                  </Button>
                  {!gem.funded && (
                    <Button
                      variant="ghost"
                      className="col-span-2"
                      onClick={() => modals.open('reserve', gem)}
                    >
                      Fund reserve shortfall
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-[15px] font-medium text-ink">Custody record</h3>
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.13em] text-emerald">
                Public fields only
              </span>
            </div>
            <dl className="divide-y divide-white/[0.06]">
              {specs.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between py-2.5 text-[13.5px]">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="text-ink-soft">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>

      <GemActionModals state={modals.state} onClose={modals.close} />
    </div>
  );
}

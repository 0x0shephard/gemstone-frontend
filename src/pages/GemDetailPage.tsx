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
import { PriceBreakdown } from '@/components/gem/PriceBreakdown';
import { ProvenanceChain } from '@/components/gem/ProvenanceChain';
import { TxButton } from '@/components/tx/TxButton';
import { dataService } from '@/services';

export default function GemDetailPage() {
  const { gemId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { data: gem, isLoading, isError } = useGem(gemId);
  const modals = useGemModals();
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

  /*
   * Read from the chain rather than the URL. These were previously derived from
   * `?market=` query parameters, so a link that omitted them — every marketplace
   * card now does — offered the wrong actions for the token's real state.
   */
  const isAuction = !gem.tokenId;
  const isSecondaryListing = Boolean(gem.listingSeller);
  const isActiveListing = isManageView && isSecondaryListing;

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
          <div className="dc-facet-border overflow-hidden rounded-[4px] border border-line/[0.09] bg-card">
            <GemThumb gem={gem} height={440} rounded="rounded-[4px]" showTag showCarat />
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
            <PriceBreakdown gem={gem} />
            <div className="mt-5 border-t border-line/[0.06] pt-5">
              <ReserveStatus gem={gem} showShortfall={false} />
            </div>

            <div className="mt-5 border-t border-line/[0.06] pt-5">
              <div className="mb-3 text-[9.5px] font-semibold uppercase tracking-[0.15em] text-ink-dim">
                {isManageView ? 'Ownership actions' : 'Available actions'}
              </div>
              {isManageView ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {isActiveListing ? (
                    <>
                      <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                        This NFT is escrowed by the Marketplace. Cancel the listing before swapping,
                        redeeming, or accepting an offer.
                      </p>
                      <TxButton
                        block
                        variant="secondary"
                        disabled={!gem.tokenId}
                        action={() => dataService.cancelListing({ tokenId: gem.tokenId! })}
                        pendingLabel="Cancelling…"
                        telemetryFlow="cancel_listing"
                      >
                        Cancel listing
                      </TxButton>
                    </>
                  ) : (
                    <>
                      <Button onClick={() => modals.open('list', gem)} disabled={!gem.tokenId}>
                        List for sale
                      </Button>
                      <Button variant="secondary" onClick={() => modals.open('swap', gem)}>
                        Propose swap
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => modals.open('send', gem)}
                        disabled={!gem.tokenId}
                      >
                        Send token
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
                    </>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  {isAuction ? (
                    <>
                      <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                        Not yet a token. Winning this 24-hour auction mints it to you — it is the
                        only way this gemstone becomes a token.
                      </p>
                      <Button className="col-span-2" onClick={() => modals.open('bid', gem)}>
                        Place bid
                      </Button>
                    </>
                  ) : isSecondaryListing ? (
                    <>
                      <Button onClick={() => modals.open('buy', gem)} disabled={!gem.tokenId}>
                        Buy now
                      </Button>
                      <Button variant="secondary" onClick={() => modals.open('offer', gem)}>
                        Make an offer
                      </Button>
                    </>
                  ) : (
                    /*
                     * Held by someone who has not listed it. There is nothing to
                     * buy, so the two ways to acquire it are an offer the owner
                     * can accept, or a swap of one token for another.
                     */
                    <>
                      <p className="col-span-2 text-[11.5px] leading-relaxed text-ink-dim">
                        This token is not listed for sale. You can offer to buy it, or propose
                        trading one of your own tokens for it.
                      </p>
                      <Button onClick={() => modals.open('offer', gem)} disabled={!gem.tokenId}>
                        Make an offer
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => modals.open('swapFor', gem)}
                        disabled={!gem.tokenId}
                      >
                        Propose a swap
                      </Button>
                    </>
                  )}
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
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-display text-[15px] font-medium text-ink">Provenance</h3>
              <span className="font-mono text-[9.5px] uppercase tracking-[0.13em] text-ink-dim">
                On chain
              </span>
            </div>
            <p className="mb-2 text-[11.5px] leading-relaxed text-ink-dim">
              Each gate is enforced by a separate role, so no single party can move a gem from
              intake to sale on its own.
            </p>
            <ProvenanceChain gem={gem} />
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-[15px] font-medium text-ink">Custody record</h3>
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.13em] text-emerald">
                Public fields only
              </span>
            </div>
            <dl className="divide-y divide-line/[0.06]">
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

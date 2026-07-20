import { useParams, Link } from 'react-router-dom';
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

export default function GemDetailPage() {
  const { gemId = '' } = useParams();
  const { data: gem, isLoading, isError } = useGem(gemId);
  const modals = useGemModals();

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
    ['Gem ID', <span className="font-mono">{gem.gemId}</span>],
    ['Type', gem.typeLabel],
    ['Carat', gem.caratsFmt],
    ['Custody', gem.custodyLabel],
    ['Fee tier', gem.feeLabel],
    ['Redemption', gem.redeem],
  ];

  return (
    <div className="space-y-6">
      <Link to="/marketplace" className="text-[13px] text-ink-muted hover:text-ink">
        ← Back to marketplace
      </Link>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: visual + stats */}
        <div className="space-y-4">
          <GemThumb gem={gem} height={420} rounded="rounded-[16px]" showTag showCarat />
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Carat" value={gem.carats.toFixed(2)} />
            <StatTile label="Custody" value={<span className="text-[15px]">{gem.custody}</span>} />
            <StatTile label="Vault fee" value={`${gem.feePct.toFixed(1)}%`} />
          </div>
        </div>

        {/* Right: pricing + actions */}
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center gap-2">
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
            <h1 className="text-[28px] font-extrabold tracking-tight text-ink">{gem.name}</h1>
          </div>

          <Card className="p-5">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-ink-dim">
                  Estimated value
                </div>
                <div className="font-mono text-[28px] font-extrabold text-ink">{gem.valueFmt}</div>
              </div>
              {shortfall > 0 && (
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-ink-dim">
                    + reserve top-up
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

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Button onClick={() => modals.open('buyNow', gem)}>Buy now</Button>
              <Button variant="secondary" onClick={() => modals.open('bid', gem)}>
                Place bid
              </Button>
              <Button variant="secondary" onClick={() => modals.open('offer', gem)}>
                Make offer
              </Button>
              <Button variant="secondary" onClick={() => modals.open('swap', gem)}>
                Offer swap
              </Button>
              {!gem.funded && (
                <Button variant="ghost" className="col-span-2" onClick={() => modals.open('reserve', gem)}>
                  Fund reserve shortfall
                </Button>
              )}
              <Button variant="ghost" className="col-span-2" onClick={() => modals.open('redeem', gem)}>
                Redeem physical gemstone
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-[15px] font-semibold text-ink">Specification</h3>
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

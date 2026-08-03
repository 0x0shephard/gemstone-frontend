import { useAuctions } from '@/hooks/useData';
import { GemThumb } from '@/components/gem/GemThumb';
import { CountdownBadge } from '@/components/ui/CountdownBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { TxButton } from '@/components/tx/TxButton';
import { PendingRefunds } from '@/components/wallet/PendingRefunds';
import { CardGridSkeleton, ErrorState, EmptyState } from '@/components/ui/States';
import { GemActionModals } from '@/components/modals/GemActionModals';
import { useGemModals } from '@/hooks/useGemModals';
import { dataService } from '@/services';
import { fmtUsdBaseUnits } from '@/lib/format';
import type { Auction, DecoratedGem } from '@/services/types';
import { useAccount } from 'wagmi';

// Was `Number(v / 10n ** 18n)` — integer division, so every floor and bid was
// rounded down to whole dollars and anything under $1 showed as $0.
const usdFromWad = (v: bigint) => fmtUsdBaseUnits(v);

interface RowProps {
  auction: Auction;
  settled: boolean;
  address?: string;
  onBid: (gem: DecoratedGem) => void;
}

function AuctionRow({ auction: a, settled, address, onBid }: RowProps) {
  const mine = Boolean(address && a.highestBidder?.toLowerCase() === address.toLowerCase());
  return (
    <tr className="border-b border-line/[0.06] transition-colors last:border-b-0 hover:bg-line/[0.02]">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <GemThumb
            gem={a.gem}
            height={34}
            rounded="rounded-[4px]"
            showTag={false}
            showCarat={false}
            className="w-[34px] shrink-0"
          />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-ink">{a.gem.name}</div>
            <div className="font-mono text-[10.5px] text-ink-dim">{a.gem.displayId}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right font-mono text-[13px] text-ink-soft">
        {usdFromWad(a.floorUsd)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-[13px] font-semibold text-ink">
        {a.bids > 0 ? a.highestBidFmt : 'No bids'}
      </td>
      <td className="px-4 py-3 text-right font-mono text-[13px] text-ink-soft">{a.bids}</td>
      <td className="px-4 py-3">
        {mine ? (
          <StatusBadge tone="success" dot>
            Winning
          </StatusBadge>
        ) : a.gem.funded ? (
          <StatusBadge tone="neutral">Funded</StatusBadge>
        ) : (
          <StatusBadge tone="warning" dot>
            Reserve short
          </StatusBadge>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <CountdownBadge seconds={a.secondsLeft} />
      </td>
      <td className="px-4 py-3 text-right">
        {settled ? (
          <TxButton
            size="sm"
            action={() => dataService.settleAuction({ gemId: a.gem.gemId })}
            pendingLabel="Settling…"
            telemetryFlow="settle_auction"
          >
            Settle
          </TxButton>
        ) : (
          <Button size="sm" onClick={() => onBid(a.gem)}>
            Place bid
          </Button>
        )}
      </td>
    </tr>
  );
}

function AuctionTable({
  rows,
  settled,
  address,
  onBid,
}: {
  rows: Auction[];
  settled: boolean;
  address?: string;
  onBid: (gem: DecoratedGem) => void;
}) {
  const headers = [
    'Stone',
    'Floor',
    'Top bid',
    'Bids',
    'Status',
    settled ? 'Ended' : 'Ends in',
    '',
  ];
  return (
    <div className="overflow-x-auto rounded-[4px] border border-line/[0.08] bg-card">
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={h + i}
                className={`whitespace-nowrap border-b border-line/[0.06] px-4 py-2.5 font-mono text-[9.5px] font-normal uppercase tracking-[0.12em] text-ink-dim ${
                  i === 0 || i === 4 ? 'text-left' : 'text-right'
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <AuctionRow
              key={a.gem.gemId.toString()}
              auction={a}
              settled={settled}
              address={address}
              onBid={onBid}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AuctionsPage() {
  const { data: auctions, isLoading, isError } = useAuctions();
  const { address } = useAccount();
  const modals = useGemModals();

  const live = auctions?.filter((a) => a.secondsLeft > 0) ?? [];
  const ended = auctions?.filter((a) => a.secondsLeft <= 0) ?? [];
  const openBid = (gem: DecoratedGem) => modals.open('bid', gem);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-5 border-b border-line/[0.06] pb-5">
        <div className="max-w-2xl">
          <h2 className="font-display text-[26px] font-medium tracking-[-0.035em] text-ink">
            Auctions
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
            Primary auctions run for 24 hours. Bids escrow on the spot and outbid deposits become
            claimable immediately.
          </p>
        </div>
        <div className="flex gap-7">
          <div>
            <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-dim">
              Live
            </div>
            <div className="mt-1 font-mono text-[19px] tracking-[-0.03em] text-ink">
              {live.length}
            </div>
          </div>
          <div>
            <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-dim">
              Awaiting settlement
            </div>
            <div className="mt-1 font-mono text-[19px] tracking-[-0.03em] text-ink">
              {ended.length}
            </div>
          </div>
        </div>
      </div>

      <PendingRefunds />

      {isLoading ? (
        <CardGridSkeleton count={3} />
      ) : isError ? (
        <ErrorState />
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex items-baseline gap-2.5">
              <h3 className="font-display text-[15px] font-medium text-ink">Live now</h3>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-dim">
                {live.length} running
              </span>
            </div>
            {live.length > 0 ? (
              <AuctionTable rows={live} settled={false} address={address} onBid={openBid} />
            ) : (
              <EmptyState
                title="No auctions running"
                hint="Stones listed in auction mode appear here for 24 hours once the lister opens them."
              />
            )}
          </section>

          {ended.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-display text-[15px] font-medium text-ink">Ready to settle</h3>
              <div className="rounded-[4px] border border-line/[0.08] border-l-2 border-l-amber bg-panel px-4 py-3">
                <div className="text-[13px] font-medium text-ink">Settlement is permissionless</div>
                <p className="mt-1 max-w-[70ch] text-[12px] leading-relaxed text-ink-muted">
                  Anyone can settle an ended auction. The contract re-checks the reserve at the
                  current oracle price first, and refunds the winner instead of minting if coverage
                  slipped.
                </p>
              </div>
              <AuctionTable rows={ended} settled address={address} onBid={openBid} />
            </section>
          )}
        </>
      )}

      <GemActionModals state={modals.state} onClose={modals.close} />
    </div>
  );
}

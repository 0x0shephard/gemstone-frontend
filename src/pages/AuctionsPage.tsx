import { useAuctions, useBidPolicy } from '@/hooks/useData';
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
import type { Auction, BindingRule, DecoratedGem } from '@/services/types';
import { useAccount } from 'wagmi';
import { Link } from 'react-router-dom';
import { groupAuctions } from '@/services/chain/marketPresentation';
import { primaryBidWithdrawable } from '@/lib/auctionBid';

// Was `Number(v / 10n ** 18n)` — integer division, so every floor and bid was
// rounded down to whole dollars and anything under $1 showed as $0.
const usdFromWad = (v: bigint) => fmtUsdBaseUnits(v);

type Mode = 'live' | 'settle' | 'unsold' | 'past';

interface RowProps {
  auction: Auction;
  mode: Mode;
  address?: string;
  onBid: (gem: DecoratedGem) => void;
  /** Undefined until the contract answers; the leading bid then counts as binding. */
  rule?: BindingRule;
}

function WithdrawBidButton({ gemId }: { gemId: bigint }) {
  return (
    <TxButton
      size="sm"
      variant="secondary"
      action={() => dataService.cancelAuctionBid({ gemId })}
      pendingLabel="Withdrawing…"
      telemetryFlow="auction_bid_withdraw"
    >
      Withdraw bid
    </TxButton>
  );
}

function AuctionRow({ auction: a, mode, address, onBid, rule }: RowProps) {
  const mine = Boolean(address && a.highestBidder?.toLowerCase() === address.toLowerCase());
  /*
   * A binding bid's only exits are settlement, being outbid, the contract
   * pausing, or the settlement grace running out. In the last two cases the
   * bidder must be able to leave from here; nothing else would offer it.
   */
  const withdrawable = primaryBidWithdrawable(a, address, rule);
  // Bidding and settlement are both `whenNotPaused`.
  const paused = rule?.paused === true;
  return (
    <tr className="border-b border-line/[0.06] transition-colors last:border-b-0 hover:bg-line/[0.02]">
      <td className="px-4 py-3">
        <Link
          to={`/gem/${a.gem.gemId}`}
          aria-label={`View details for ${a.gem.name}`}
          className="group flex items-center gap-3"
        >
          <GemThumb
            gem={a.gem}
            height={34}
            rounded="rounded-[4px]"
            showTag={false}
            showCarat={false}
            className="w-[34px] shrink-0"
          />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-ink underline-offset-2 group-hover:underline">
              {a.gem.name}
            </div>
            <div className="font-mono text-[10.5px] text-ink-dim">{a.gem.displayId}</div>
          </div>
        </Link>
      </td>
      <td className="px-4 py-3 text-right font-mono text-[13px] text-ink-soft">
        {usdFromWad(a.floorUsd)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-[13px] font-semibold text-ink">
        {/* The highest bid is contract state; a cancelled bid leaves no leader. */}
        {a.highestBidder ? a.highestBidFmt : 'No bids'}
      </td>
      <td className="px-4 py-3 text-right font-mono text-[13px] text-ink-soft">
        {Math.max(a.bids, a.highestBidder ? 1 : 0)}
      </td>
      <td className="px-4 py-3">
        {mode === 'past' ? (
          <StatusBadge tone={a.outcome === 'Minted' ? 'success' : 'warning'} dot>
            {a.outcome === 'Minted' ? 'Sold' : 'Refunded'}
          </StatusBadge>
        ) : mine ? (
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
        {mode === 'past' ? (
          <span className="font-mono text-[11px] text-ink-dim">Completed</span>
        ) : (
          <CountdownBadge seconds={a.secondsLeft} />
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {mode === 'settle' ? (
          <div className="flex justify-end gap-2">
            {withdrawable && <WithdrawBidButton gemId={a.gem.gemId} />}
            {paused ? (
              <span className="text-[11px] text-ink-dim">Paused</span>
            ) : (
              <TxButton
                size="sm"
                action={() => dataService.settleAuction({ gemId: a.gem.gemId })}
                pendingLabel="Settling…"
                telemetryFlow="settle_auction"
              >
                Settle
              </TxButton>
            )}
          </div>
        ) : mode === 'unsold' ? (
          <span className="text-[11px] text-ink-dim">No bids · awaiting a new round</span>
        ) : mode === 'live' && mine ? (
          <div className="flex justify-end gap-2">
            {!paused && (
              <Button size="sm" onClick={() => onBid(a.gem)}>
                Raise bid
              </Button>
            )}
            {withdrawable && <WithdrawBidButton gemId={a.gem.gemId} />}
          </div>
        ) : mode === 'live' ? (
          <Button size="sm" disabled={paused} onClick={() => onBid(a.gem)}>
            {paused ? 'Paused' : 'Place bid'}
          </Button>
        ) : (
          <Link
            to={`/gem/${a.gem.gemId}`}
            className="text-[12px] font-semibold text-atelier hover:underline"
          >
            {a.tokenId ? `Token #${a.tokenId}` : 'View stone'}
          </Link>
        )}
      </td>
    </tr>
  );
}

function AuctionTable({
  rows,
  mode,
  address,
  onBid,
}: {
  rows: Auction[];
  mode: Mode;
  address?: string;
  onBid: (gem: DecoratedGem) => void;
}) {
  // Until the contract answers, hide the withdrawal rather than offer one that may revert.
  const { data: policy } = useBidPolicy();
  const headers = [
    'Stone',
    'Floor',
    'Top bid',
    'Bids',
    'Status',
    mode === 'live' ? 'Ends in' : 'Ended',
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
              mode={mode}
              address={address}
              onBid={onBid}
              rule={policy?.primary}
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

  const {
    live,
    awaitingSettlement: ended,
    endedWithoutBids: unsold,
    past,
  } = groupAuctions(auctions ?? []);
  const openBid = (gem: DecoratedGem) => modals.open('bid', gem);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-5 border-b border-line/[0.06] pb-5">
        <div className="max-w-2xl">
          <h2 className="font-display text-[26px] font-medium tracking-[-0.035em] text-ink">
            Auctions
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
            Primary auctions run for 24 hours. Bids escrow on the spot and outbid deposits return to
            the bidder automatically; a claim remains available if a wallet rejects the refund.
          </p>
        </div>
        <div className="flex gap-7">
          <div>
            <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-dim">
              Live
            </div>
            <div className="mt-1 font-mono text-[19px] tracking-[-0.03em] text-ink">
              {isLoading ? '—' : live.length}
            </div>
          </div>
          <div>
            <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-dim">
              Awaiting settlement
            </div>
            <div className="mt-1 font-mono text-[19px] tracking-[-0.03em] text-ink">
              {isLoading ? '—' : ended.length}
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
              <AuctionTable rows={live} mode="live" address={address} onBid={openBid} />
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
                  slipped. If nobody settles within the grace period, or while the contract is
                  paused, the leading bidder can withdraw instead.
                </p>
              </div>
              <AuctionTable rows={ended} mode="settle" address={address} onBid={openBid} />
            </section>
          )}

          {unsold.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-baseline gap-2.5">
                <h3 className="font-display text-[15px] font-medium text-ink">
                  Ended without a bid
                </h3>
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-dim">
                  nothing to settle
                </span>
              </div>
              <AuctionTable rows={unsold} mode="unsold" address={address} onBid={openBid} />
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-baseline gap-2.5">
              <h3 className="font-display text-[15px] font-medium text-ink">Past auctions</h3>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-dim">
                {past.length} completed
              </span>
            </div>
            {past.length > 0 ? (
              <AuctionTable rows={past} mode="past" address={address} onBid={openBid} />
            ) : (
              <EmptyState
                title="No completed auctions yet"
                hint="Settled auctions remain here so every stone's sale can be traced."
              />
            )}
          </section>
        </>
      )}

      <GemActionModals state={modals.state} onClose={modals.close} />
    </div>
  );
}

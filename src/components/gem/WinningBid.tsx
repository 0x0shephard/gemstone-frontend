import { CountdownBadge } from '@/components/ui/CountdownBadge';
import { explorerAddressUrl } from '@/config/chains';
import { shortenAddress } from '@/lib/format';
import type { BidSummary } from '@/services/chain/bidSummary';

export function bidCountLabel(summary: BidSummary): string {
  return `${summary.bidders} ${summary.bidders === 1 ? 'bid' : 'bids'}`;
}

/** "Winning bid" for a listing auction, "Top offer" for open offers on an unlisted token. */
export function winningBidTitle(summary: BidSummary): string {
  return summary.kind === 'listing-auction' ? 'Winning bid' : 'Top offer';
}

/**
 * The current winning bid on a token: amount, who placed it and how many bid.
 * `compact` is one line for cards and tables; the full form adds the time left.
 */
export function WinningBid({
  summary,
  compact = false,
}: {
  summary: BidSummary;
  compact?: boolean;
}) {
  const bidder = (
    <a
      href={explorerAddressUrl(summary.winning.bidder)}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="relative z-20 font-mono text-ink-muted underline decoration-line/30 underline-offset-2 hover:text-ink"
    >
      {shortenAddress(summary.winning.bidder)}
    </a>
  );
  if (compact) {
    return (
      <span className="text-[11.5px] text-ink-muted">
        <span className="font-mono font-semibold text-ink">{summary.winning.offerFmt}</span> by{' '}
        {bidder} · {bidCountLabel(summary)}
      </span>
    );
  }
  return (
    <div className="rounded-[4px] border border-atelier/20 bg-atelier/[0.04] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.15em] text-atelier">
          {winningBidTitle(summary)}
        </span>
        {summary.kind === 'listing-auction' && summary.secondsLeft !== undefined && (
          <CountdownBadge seconds={summary.secondsLeft} />
        )}
      </div>
      <div className="mt-1 font-mono text-[20px] font-semibold tracking-[-0.03em] text-ink">
        {summary.winning.offerFmt}
      </div>
      <div className="mt-0.5 text-[11.5px] text-ink-muted">
        by {bidder} · {bidCountLabel(summary)}
        {summary.kind === 'offers' && ' · the owner chooses which offer to accept'}
      </div>
    </div>
  );
}

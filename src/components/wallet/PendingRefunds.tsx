import { useAccount } from 'wagmi';
import { usePendingRefunds } from '@/hooks/useData';
import { Card } from '@/components/ui/Card';
import { TxButton } from '@/components/tx/TxButton';
import { dataService } from '@/services';
import type { RefundSource } from '@/services/types';

const SOURCE_LABEL: Record<RefundSource, string> = {
  PrimarySaleAuction: 'Auction credit',
  Marketplace: 'Marketplace credit',
};

/**
 * Credits waiting to be withdrawn, from both contracts that hold them.
 *
 * `PrimarySaleAuction` credits an outbid or withdrawn bid, and `Marketplace`
 * credits any refund or sale proceeds it could not push to a wallet (one that
 * rejects ETH, for example). Either way the money sits in that contract until
 * its owner calls `claimRefund` there. Without this the balance is invisible and
 * effectively stranded, so it is surfaced wherever the user looks at their own
 * position. Each row claims from the contract that holds it.
 */
export function PendingRefunds() {
  const { address } = useAccount();
  const { data: refunds, refetch } = usePendingRefunds(address);

  if (!address || !refunds || refunds.length === 0) return null;

  return (
    <Card className="dc-facet-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber">
            Credits to withdraw
          </div>
          <div className="mt-1 font-display text-[21px] font-medium text-ink">
            {refunds.length === 1
              ? `${refunds[0].amountFmt} ready to withdraw`
              : `${refunds.length} credits ready to withdraw`}
          </div>
          <p className="mt-1 max-w-[56ch] text-[12px] leading-relaxed text-ink-muted">
            Bids that were outbid or withdrawn, and payments the contracts could not send straight
            to your wallet, are held for you here. They stay in the contract until you withdraw them
            and they do not expire.
          </p>
        </div>
      </div>

      <div className="mt-4 divide-y divide-line/[0.06] border-t border-line/[0.06]">
        {refunds.map((refund) => (
          <div
            key={`${refund.source}:${refund.paymentAsset}`}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <div className="font-mono text-[15px] font-semibold tracking-[-0.02em] text-ink">
                {refund.amountFmt}
              </div>
              <div className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-dim">
                {SOURCE_LABEL[refund.source]} · {refund.symbol}
              </div>
            </div>
            <TxButton
              size="sm"
              action={() =>
                dataService.claimRefund({
                  paymentAsset: refund.paymentAsset,
                  source: refund.source,
                })
              }
              onConfirmed={() => refetch().then(() => undefined)}
              pendingLabel="Withdrawing…"
              telemetryFlow={
                refund.source === 'Marketplace'
                  ? 'marketplace_refund_claim'
                  : 'auction_refund_claim'
              }
            >
              Withdraw {refund.symbol}
            </TxButton>
          </div>
        ))}
      </div>
    </Card>
  );
}

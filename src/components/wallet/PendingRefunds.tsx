import { useAccount } from 'wagmi';
import { usePendingAuctionRefunds } from '@/hooks/useData';
import { Card } from '@/components/ui/Card';
import { TxButton } from '@/components/tx/TxButton';
import { dataService } from '@/services';

/**
 * Outbid auction deposits.
 *
 * `PrimarySaleAuction` credits refunds rather than pushing them, so a losing
 * bidder's money sits in the contract until they withdraw it. Without this the
 * balance is invisible and effectively stranded, so it is surfaced wherever the
 * user looks at their own position.
 */
export function PendingRefunds() {
  const { address } = useAccount();
  const { data: refunds, refetch } = usePendingAuctionRefunds(address);

  if (!address || !refunds || refunds.length === 0) return null;

  return (
    <Card className="dc-facet-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber">
            Outbid deposits
          </div>
          <div className="mt-1 font-display text-[21px] font-medium text-ink">
            {refunds.length === 1
              ? `${refunds[0].amountFmt} ready to withdraw`
              : `${refunds.length} deposits ready to withdraw`}
          </div>
          <p className="mt-1 max-w-[52ch] text-[12px] leading-relaxed text-ink-muted">
            You were outbid, so your escrow was credited back to you. It is held by the auction
            contract until you withdraw it and it does not expire.
          </p>
        </div>
      </div>

      <div className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
        {refunds.map((refund) => (
          <div
            key={refund.paymentAsset}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <div className="font-mono text-[15px] font-semibold tracking-[-0.02em] text-ink">
                {refund.amountFmt}
              </div>
              <div className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-dim">
                {refund.symbol}
              </div>
            </div>
            <TxButton
              size="sm"
              action={async () => {
                const result = await dataService.claimRefund({
                  paymentAsset: refund.paymentAsset,
                });
                await refetch();
                return result;
              }}
              pendingLabel="Withdrawing…"
              telemetryFlow="auction_refund_claim"
            >
              Withdraw {refund.symbol}
            </TxButton>
          </div>
        ))}
      </div>
    </Card>
  );
}

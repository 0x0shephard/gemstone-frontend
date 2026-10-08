import type { Hash } from 'viem';
import { explorerTxUrl } from '@/config/chains';
import type { Redemption } from '@/services/types';
import type { RedemptionWorkflow, RedemptionWorkflowStatus } from '@/services/offchain/redemptions';

const STATUS_TEXT: Record<RedemptionWorkflowStatus, string> = {
  draft: 'Fulfillment record incomplete',
  committed: 'Details saved · awaiting chain reconciliation',
  onchain_requested: 'Request open · awaiting Digital Carat acceptance',
  cancelled: 'Request cancelled',
  fulfilled: 'Fulfillment confirmed',
};

export function redemptionWorkflowStatusText(
  status: RedemptionWorkflowStatus,
  chainConfirmed: boolean,
): string {
  if (chainConfirmed && status === 'committed') {
    return 'Chain confirmed · backend indexing in progress';
  }
  // Rows past acceptance carry the vault lifecycle's states; the tracker
  // above shows their detail, so the receipt only says the request is moving.
  return STATUS_TEXT[status] ?? 'Request open · with the custodian vault';
}

export function redemptionWorkflowTitle(
  status: RedemptionWorkflowStatus,
  chainConfirmed: boolean,
): string {
  if (status === 'draft') return 'Redemption details need attention';
  if (!chainConfirmed && status === 'committed') return 'Fulfillment details saved';
  if (status === 'cancelled') return 'Redemption request cancelled';
  if (status === 'fulfilled') return 'Redemption fulfilled';
  return 'Redemption request recorded';
}

export function RedemptionReceipt({
  workflow,
  chainConfirmed = false,
  transactionHash,
  live = false,
}: {
  workflow: RedemptionWorkflow;
  chainConfirmed?: boolean;
  transactionHash?: Hash | null;
  live?: boolean;
}) {
  const txHash = transactionHash ?? workflow.transactionHash;
  return (
    <div
      className="space-y-2 rounded-[4px] border border-emerald/20 bg-emerald/[0.055] p-3"
      role={live ? 'status' : undefined}
      aria-live={live ? 'polite' : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[12px] font-semibold text-emerald">
          {redemptionWorkflowTitle(workflow.status, chainConfirmed)}
        </h4>
        <span className="text-[11px] text-ink-muted">
          {workflow.method === 'pickup' ? 'Secure vault pickup' : 'Insured delivery'}
        </span>
      </div>
      <dl className="space-y-1.5 text-[11.5px]">
        <div>
          <dt className="text-ink-dim">Status</dt>
          <dd className="text-ink-soft">
            {redemptionWorkflowStatusText(workflow.status, chainConfirmed)}
          </dd>
        </div>
        <div>
          <dt className="text-ink-dim">Request ID</dt>
          <dd className="break-all font-mono text-ink-soft">{workflow.workflowId}</dd>
        </div>
        <div>
          <dt className="text-ink-dim">Commitment hash</dt>
          <dd className="break-all font-mono text-ink-soft">
            {workflow.requestHash ?? 'Not committed'}
          </dd>
        </div>
        {txHash && (
          <div>
            <dt className="text-ink-dim">Transaction hash</dt>
            <dd className="break-all font-mono">
              <a
                href={explorerTxUrl(txHash)}
                target="_blank"
                rel="noreferrer"
                aria-label={`View transaction ${txHash} on explorer`}
                className="text-emerald underline underline-offset-2"
              >
                {txHash} ↗
              </a>
            </dd>
          </div>
        )}
      </dl>
      <p className="text-[11px] leading-relaxed text-ink-muted">
        This receipt is also available on the Redeem page after a reload.
      </p>
    </div>
  );
}

export function RedemptionReceipts({
  workflows,
  redemptions,
}: {
  workflows: RedemptionWorkflow[];
  redemptions: Redemption[];
}) {
  if (workflows.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby="redemption-receipts-heading">
      <h3 id="redemption-receipts-heading" className="text-[16px] font-semibold text-ink">
        Your request receipts
      </h3>
      <div className="grid gap-3 lg:grid-cols-2">
        {workflows.map((workflow) => {
          const chainRequest = workflow.requestHash
            ? redemptions.find(
                (redemption) =>
                  redemption.requestHash?.toLowerCase() === workflow.requestHash?.toLowerCase(),
              )
            : undefined;
          return (
            <RedemptionReceipt
              key={workflow.workflowId}
              workflow={workflow}
              chainConfirmed={Boolean(chainRequest)}
              transactionHash={chainRequest?.transactionHash}
            />
          );
        })}
      </div>
    </section>
  );
}

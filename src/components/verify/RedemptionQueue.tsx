import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TxButton } from '@/components/tx/TxButton';
import { WalletAddress } from '@/components/wallet/WalletAddress';
import { dataService } from '@/services';

/**
 * Redemptions waiting on a custodian.
 *
 * The last step of the flow and the only one with no automation behind it:
 * `RedemptionManager.confirmRedemption` checks `msg.sender != gem.custodian`, an
 * exact address rather than a role, so a request stays open until that one
 * wallet acts. Until this panel existed there was nowhere in the operator portal
 * that showed such a request at all, and the owner's side reported "Custodian
 * fulfillment, 60%" indefinitely — a constant, not a measurement.
 *
 * Portal access and the right to confirm are deliberately different things. Being
 * signed in here says the operator may *see* the queue; only the connected wallet
 * matching the gem's custodian can finish one, and the panel says which of those
 * two is missing rather than presenting a button that reverts.
 */
export function RedemptionQueue() {
  const { address, isConnected } = useAccount();
  const {
    data: redemptions = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['verify', 'redemptions'],
    queryFn: () => dataService.getRedemptions(),
  });

  const connected = address?.toLowerCase();

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line/[0.08] px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold text-ink">Awaiting handover</h2>
          <p className="mt-0.5 text-[11.5px] text-ink-muted">
            Owners who have asked for their physical stone. Nothing moves until the custodian
            confirms.
          </p>
        </div>
        <StatusBadge tone={redemptions.length > 0 ? 'warning' : 'neutral'} dot>
          {redemptions.length} open
        </StatusBadge>
      </div>

      {isLoading ? (
        <p className="px-4 py-6 text-[12px] text-ink-dim">Reading open redemptions…</p>
      ) : redemptions.length === 0 ? (
        <p className="px-4 py-6 text-[12px] text-ink-dim">
          No redemption requests are open. One appears here the moment an owner asks for delivery.
        </p>
      ) : (
        <ul className="divide-y divide-line/[0.06]">
          {redemptions.map((redemption) => {
            const isCustodian = connected === redemption.custodian.toLowerCase();
            return (
              <li key={redemption.workflowId} className="px-4 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold text-ink">
                      {redemption.gem.name}
                    </div>
                    <div className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-dim">
                      {redemption.gem.displayId} · Token #{String(redemption.tokenId)}
                    </div>
                  </div>
                  <StatusBadge color={redemption.statusColor} dot>
                    {redemption.status}
                  </StatusBadge>
                </div>

                <dl className="mt-3 grid gap-2 text-[11.5px] sm:grid-cols-2">
                  <div>
                    <dt className="text-ink-dim">Owner</dt>
                    <dd className="mt-0.5">
                      <WalletAddress address={redemption.owner} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-dim">Custodian</dt>
                    <dd className="mt-0.5">
                      <WalletAddress address={redemption.custodian} />
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex flex-col gap-2 border-t border-line/[0.06] pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[11.5px] leading-relaxed text-ink-dim">
                    {!isConnected
                      ? 'Connect the custodian wallet to confirm a handover.'
                      : isCustodian
                        ? 'Confirming burns the token and releases the reserve to you. It cannot be undone — do it once the stone is physically with its owner.'
                        : 'This stone is held by a different custodian, so it cannot be confirmed from the connected wallet.'}
                  </p>
                  <TxButton
                    size="sm"
                    disabled={!isCustodian}
                    action={() => dataService.confirmRedemption({ tokenId: redemption.tokenId })}
                    onDone={() => void refetch()}
                    pendingLabel="Confirming…"
                    telemetryFlow="redemption_confirm"
                  >
                    Confirm handover
                  </TxButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

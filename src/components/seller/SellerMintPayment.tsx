import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatUnits } from 'viem';
import { TxButton } from '@/components/tx/TxButton';
import { PaymentAssetSelector } from '@/components/payment/PaymentAssetSelector';
import { dataService } from '@/services';
import { syncSellerMint } from '@/services/offchain/workflows';
import { fmtUsd } from '@/lib/format';
import type { PaymentAsset } from '@/services/types';

/**
 * Seller-paid "mint to my wallet".
 *
 * Only reached when the stone is listed to mint but the contract wants a
 * reserve shortfall or mint fee first, which the operator cannot pay. The
 * seller pays it in ETH or USDC and signs `mintToSeller`; the NFT always goes
 * to their registered wallet. Afterwards the server re-reads the chain to
 * record the mint.
 */
export function SellerMintPayment({
  submissionId,
  gemId,
  onMinted,
}: {
  submissionId: string;
  gemId: bigint;
  onMinted: () => void | Promise<void>;
}) {
  const [asset, setAsset] = useState<PaymentAsset>();
  const { data: due } = useQuery({
    queryKey: ['sellerMintDue', gemId.toString()],
    queryFn: () => dataService.getSellerMintDue(gemId),
  });
  const dueUsd = due ? Number(formatUnits(due.reserveUsd + due.feeUsd, 18)) : undefined;

  return (
    <div className="basis-full space-y-2 rounded-[4px] border border-line/[0.08] bg-panel p-3">
      <p className="text-[11.5px] leading-relaxed text-ink-muted">
        {dueUsd === undefined
          ? 'Checking what is due to mint this stone…'
          : `Minting to your wallet costs ${fmtUsd(dueUsd)}${
              due && due.reserveUsd > 0n
                ? `, including a ${fmtUsd(Number(formatUnits(due.reserveUsd, 18)))} reserve top-up`
                : ''
            }. Any surplus from price movement is refunded.`}
      </p>
      <PaymentAssetSelector value={asset?.address} onChange={setAsset} />
      <TxButton
        size="sm"
        disabled={!asset || dueUsd === undefined}
        action={() => dataService.mintToSeller({ gemId, paymentAsset: asset!.address })}
        pendingLabel="Minting…"
        onConfirmed={async () => {
          await syncSellerMint(submissionId).catch(() => undefined);
          await onMinted();
        }}
        telemetryFlow="seller_mint"
      >
        {dueUsd === undefined ? 'Mint to my wallet' : `Pay ${fmtUsd(dueUsd)} and mint`}
      </TxButton>
    </div>
  );
}

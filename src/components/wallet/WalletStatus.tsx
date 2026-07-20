import { useAccount, useChainId } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { activeChain } from '@/config/chains';
import { shortenAddress } from '@/lib/format';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/cn';

interface WalletStatusProps {
  /** 'chip' = compact address chip; 'full' = RainbowKit ConnectButton. */
  variant?: 'chip' | 'full';
  className?: string;
}

/** Wallet connection state — connect CTA, connected chip, wrong-network flag. */
export function WalletStatus({ variant = 'chip', className }: WalletStatusProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wrongNetwork = isConnected && chainId !== activeChain.id;

  if (variant === 'full') {
    return (
      <div className={className}>
        <ConnectButton showBalance={false} accountStatus="full" chainStatus="icon" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className={className}>
        <ConnectButton.Custom>
          {({ openConnectModal }) => (
            <button
              onClick={openConnectModal}
              className="dc-btn-anim rounded-[9px] border border-white/[0.16] bg-white/[0.04] px-3.5 py-2 text-[13px] font-semibold text-ink"
            >
              Connect wallet
            </button>
          )}
        </ConnectButton.Custom>
      </div>
    );
  }

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      {wrongNetwork ? (
        <StatusBadge tone="danger" dot>
          Wrong network
        </StatusBadge>
      ) : (
        <StatusBadge tone="success" dot>
          {activeChain.name}
        </StatusBadge>
      )}
      <span className="rounded-[8px] border border-white/[0.1] bg-white/[0.03] px-2.5 py-1.5 font-mono text-[12px] text-ink-soft">
        {shortenAddress(address)}
      </span>
    </div>
  );
}

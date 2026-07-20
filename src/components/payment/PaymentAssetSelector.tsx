import type { PaymentAsset } from '@/services/types';
import { usePaymentAssets } from '@/hooks/useData';
import { cn } from '@/lib/cn';

interface PaymentAssetSelectorProps {
  value?: string;
  onChange: (asset: PaymentAsset) => void;
  className?: string;
}

/**
 * Choose an accepted payment asset (from PaymentTokenRegistry, mocked).
 * ETH uses address(0). ERC-20 selections drive an approve→call flow upstream.
 */
export function PaymentAssetSelector({ value, onChange, className }: PaymentAssetSelectorProps) {
  const { data: assets = [], isLoading } = usePaymentAssets();

  if (isLoading) {
    return <div className="h-10 animate-pulse rounded-[10px] bg-white/[0.04]" />;
  }

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {assets.map((asset) => {
        const active = value === asset.address;
        return (
          <button
            key={asset.address}
            type="button"
            onClick={() => onChange(asset)}
            className={cn(
              'dc-btn-anim inline-flex items-center gap-2 rounded-[9px] border px-3.5 py-2 text-[13px] font-medium',
              active
                ? 'border-transparent bg-btn-primary text-[#0A0A0C]'
                : 'border-white/[0.1] bg-white/[0.03] text-ink-faint',
            )}
          >
            <span className="font-semibold">{asset.symbol}</span>
            {asset.isNative && (
              <span className={cn('font-mono text-[10px]', active ? 'text-black/50' : 'text-ink-dim')}>
                native
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

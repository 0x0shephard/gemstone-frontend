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
  const { data: allAssets = [], isLoading } = usePaymentAssets();
  // Registry state decides what is offered. An asset turned off on chain cannot
  // settle a payment, and listing it would produce a transaction that reverts
  // after the buyer has already approved an allowance.
  const assets = allAssets.filter((asset) => asset.enabled);

  if (isLoading) {
    return <div className="h-[58px] animate-pulse rounded-[4px] bg-line/[0.04]" />;
  }

  if (assets.length === 0) {
    return (
      <p className="rounded-[4px] border border-line/[0.09] bg-inset px-3.5 py-3 text-[12px] leading-relaxed text-ink-muted">
        No payment asset is currently accepted. The registry has every option disabled, so payments
        cannot settle until an operator re-enables one.
      </p>
    );
  }

  return (
    <div className={cn('grid grid-cols-2 gap-2', className)}>
      {assets.map((asset) => {
        const active = value === asset.address;
        return (
          <button
            key={asset.address}
            type="button"
            onClick={() => onChange(asset)}
            aria-pressed={active}
            className={cn(
              'flex min-h-[58px] items-center justify-between rounded-[4px] border px-3.5 py-2.5 text-left transition-colors',
              active
                ? 'border-atelier/40 bg-atelier/[0.08] text-ink shadow-[inset_0_0_0_1px_rgb(var(--dc-accent-rgb)/.08)]'
                : 'border-line/[0.09] bg-inset text-ink-faint hover:border-line/[0.16]',
            )}
          >
            <span>
              <span className="block text-[13px] font-semibold">{asset.symbol}</span>
              <span className="mt-0.5 block text-[10.5px] text-ink-dim">
                {asset.isNative ? 'Native payment' : 'Stablecoin'}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border text-[10px]',
                active
                  ? 'border-atelier bg-atelier text-[var(--dc-button-ink)]'
                  : 'border-line/[0.13] text-transparent',
              )}
            >
              ✓
            </span>
          </button>
        );
      })}
    </div>
  );
}

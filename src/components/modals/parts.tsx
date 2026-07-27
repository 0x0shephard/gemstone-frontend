import type { DecoratedGem, PaymentAsset } from '@/services/types';
import { GemThumb } from '@/components/gem/GemThumb';

/** Compact gem header used inside action modals. */
export function ModalGemHeader({ gem }: { gem: DecoratedGem }) {
  return (
    <div className="flex items-center gap-3 rounded-[4px] border border-line/[0.08] bg-panel p-3">
      <GemThumb
        gem={gem}
        height={44}
        rounded="rounded-[4px]"
        showTag={false}
        showCarat={false}
        className="w-11 shrink-0"
      />
      <div className="min-w-0">
        <div className="truncate text-[14px] font-semibold text-ink">{gem.name}</div>
        <div className="font-mono text-[11.5px] text-ink-dim">{gem.displayId}</div>
      </div>
      <div className="ml-auto text-right">
        <div className="font-mono text-[14px] font-semibold text-ink">{gem.valueFmt}</div>
        <div className="text-[11px]" style={{ color: gem.reserveColor }}>
          {gem.reserveLabel}
        </div>
      </div>
    </div>
  );
}

/** A labeled key/value summary row. */
export function SummaryRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1 text-[13px]">
      <span className="text-ink-muted">{label}</span>
      <span className="font-mono font-semibold" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}

/** Approx asset amount for a USD figure (preview only). */
export function assetAmountPreview(usd: number, asset?: PaymentAsset): string {
  if (!asset) return '';
  const amt = usd / asset.usdPrice;
  const formatted = asset.isNative
    ? amt.toFixed(4)
    : amt.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `≈ ${formatted} ${asset.symbol}`;
}

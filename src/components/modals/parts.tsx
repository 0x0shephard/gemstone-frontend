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

/**
 * Approx asset amount for a USD figure (preview only).
 *
 * Two decimals is right for a $3,000 purchase and actively misleading for a
 * four-tenths-of-a-cent reserve top-up, which rendered as "≈ 0 mUSDC" while the
 * transaction it described sent 4,001 base units. A figure the user reads as
 * zero, attached to a button that then asks them to sign, is worse than no
 * figure at all — so small amounts keep enough digits to be non-zero.
 */
export function assetAmountPreview(usd: number, asset?: PaymentAsset): string {
  if (!asset) return '';
  const amt = usd / asset.usdPrice;
  if (amt === 0) return `≈ 0 ${asset.symbol}`;
  const decimals = asset.isNative ? 4 : 2;
  // Enough places to show at least two significant digits, so a real amount is
  // never presented as nothing.
  const needed = Math.max(decimals, Math.ceil(-Math.log10(Math.abs(amt))) + 1);
  const formatted = amt.toLocaleString('en-US', {
    maximumFractionDigits: Math.min(needed, 8),
  });
  return `≈ ${formatted} ${asset.symbol}`;
}

import { formatUnits } from 'viem';
import type { Gem, GemType, DecoratedGem } from '@/services/types';
import { fmtUsd, fmtCarats } from './format';

/** Accent color per gem type (matches the mockup + design tokens). */
export function colorFor(type: GemType): string {
  return type === 'ruby'
    ? 'var(--dc-ruby)'
    : type === 'sapphire'
      ? 'var(--dc-sapphire)'
      : 'var(--dc-emerald)';
}

/** Faux-faceted gem thumbnail background, tinted by gem color. */
export function thumbFor(type: GemType): string {
  const c = colorFor(type);
  return (
    `radial-gradient(60% 70% at 38% 30%, color-mix(in srgb, ${c} 34%, transparent), transparent 60%), ` +
    `conic-gradient(from 210deg at 62% 58%, color-mix(in srgb, ${c} 25%, transparent), var(--dc-vault) 30%, color-mix(in srgb, ${c} 13%, transparent) 55%, var(--dc-vault) 80%, color-mix(in srgb, ${c} 20%, transparent)), ` +
    `var(--dc-sidebar)`
  );
}

/** Inline style object for a gem-type tag pill. */
export function tagStyleFor(type: GemType): React.CSSProperties {
  const c = colorFor(type);
  return {
    color: c,
    background: `color-mix(in srgb, ${c} 12%, transparent)`,
    border: `1px solid color-mix(in srgb, ${c} 34%, transparent)`,
  };
}

/**
 * How far a reserve is from full, as a label.
 *
 * `Gem.reserve` is the percentage *funded*, so the shortfall is its complement.
 * Printing the funded figure after the word "Short" stated the exact opposite
 * of the truth — a stone 99.99% funded, needing four tenths of a cent, read as
 * "Short 99.99%".
 */
export function shortfallLabel(fundedPct: number): string {
  const short = Math.max(0, 100 - fundedPct);
  if (short === 0) return 'Short 0%';
  // Below a hundredth of a percent there is no honest way to write the number,
  // and rounding it to "0%" would claim the gem is funded when it is not.
  if (short < 0.01) return 'Short <0.01%';
  return `Short ${short < 1 ? Number(short.toFixed(2)) : Math.round(short)}%`;
}

/** Enrich a raw gem with derived presentational fields. */
export function decorate(g: Gem): DecoratedGem {
  const color = colorFor(g.type);
  const funded = g.reserve >= 100;
  return {
    ...g,
    color,
    valueFmt: fmtUsd(g.value),
    listedPriceFmt: g.listedPrice === undefined ? undefined : fmtUsd(g.listedPrice),
    caratsFmt: fmtCarats(g.carats),
    thumb: thumbFor(g.type),
    reserveLabel: funded ? 'Funded 100%' : shortfallLabel(g.reserve),
    reserveColor: funded ? 'var(--dc-emerald)' : 'var(--dc-amber)',
    funded,
    feeLabel: `${g.feeTier} · ${g.feePct.toFixed(1)}%`,
    custodyLabel: `Verified · ${g.custodyProvider}, ${g.custodyCountry}`,
  };
}

/**
 * USD shortfall needed to fully fund a gem's reserve.
 *
 * Reads the figure the chain reported (`ReserveManager.shortfallUsd`) rather
 * than re-deriving it. This previously assumed a flat 800 bps reserve ratio,
 * which matches no bracket in the deployed table — reserves are 1000 bps below
 * $1,000 and 400 bps above it. Every quoted total was therefore wrong: understated
 * by a fifth on small stones and doubled on large ones, while `FundReserveModal`
 * displayed the guess and sent the real value, so the two disagreed on screen.
 */
export function reserveShortfallUsd(g: Gem): number {
  return Number(formatUnits(g.reserveShortfallUsd, 18));
}

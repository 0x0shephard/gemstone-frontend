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

/** Enrich a raw gem with derived presentational fields. */
export function decorate(g: Gem): DecoratedGem {
  const color = colorFor(g.type);
  const funded = g.reserve >= 100;
  return {
    ...g,
    color,
    valueFmt: fmtUsd(g.value),
    caratsFmt: fmtCarats(g.carats),
    thumb: thumbFor(g.type),
    reserveLabel: funded ? 'Funded 100%' : `Short ${g.reserve}%`,
    reserveColor: funded ? 'var(--dc-emerald)' : 'var(--dc-amber)',
    funded,
    feeLabel: `${g.feeTier} · ${g.feePct.toFixed(1)}%`,
    custodyLabel: `Verified · ${g.custodyProvider}, ${g.custodyCountry}`,
  };
}

/** USD shortfall needed to fully fund a gem's reserve (preview only). */
export function reserveShortfallUsd(g: Gem, reserveRatioBps = 800): number {
  const requiredReserve = (g.value * reserveRatioBps) / 10_000;
  const fundedReserve = (requiredReserve * g.reserve) / 100;
  return Math.max(0, requiredReserve - fundedReserve);
}

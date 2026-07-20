import type { Gem, GemType, DecoratedGem } from '@/services/types';
import { fmtUsd, fmtCarats } from './format';

/** Accent color per gem type (matches the mockup + design tokens). */
export function colorFor(type: GemType): string {
  return type === 'ruby' ? '#E5484D' : type === 'sapphire' ? '#5B8DEF' : '#35B98A';
}

/** Faux-faceted gem thumbnail background, tinted by gem color. */
export function thumbFor(type: GemType): string {
  const c = colorFor(type);
  return (
    `radial-gradient(60% 70% at 38% 30%, ${c}55, transparent 60%), ` +
    `conic-gradient(from 210deg at 62% 58%, ${c}40, #0c0c10 30%, ${c}22 55%, #0c0c10 80%, ${c}33), ` +
    `#0b0b0e`
  );
}

/** Inline style object for a gem-type tag pill. */
export function tagStyleFor(type: GemType): React.CSSProperties {
  const c = colorFor(type);
  return { color: c, background: `${c}1f`, border: `1px solid ${c}55` };
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
    reserveColor: funded ? '#35B98A' : '#E5A23C',
    funded,
    feeLabel: `${g.feeTier} · ${g.feePct.toFixed(1)}%`,
    custodyLabel: `Verified · ${g.custody}`,
  };
}

/** USD shortfall needed to fully fund a gem's reserve (preview only). */
export function reserveShortfallUsd(g: Gem, reserveRatioBps = 800): number {
  const requiredReserve = (g.value * reserveRatioBps) / 10_000;
  const fundedReserve = (requiredReserve * g.reserve) / 100;
  return Math.max(0, requiredReserve - fundedReserve);
}

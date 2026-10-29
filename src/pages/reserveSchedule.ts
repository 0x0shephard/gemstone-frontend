import type { FeeTier } from '@/services/types';

/**
 * What the live reserve schedule says, for copy that must not overstate it.
 *
 * - `zero`: every bracket is 0 bps, so no reserve is added or held;
 * - `charged`: at least one bracket charges a reserve;
 * - `unknown`: not loaded, unreadable, or rates without basis points, so the
 *   copy names the schedule instead of a rate.
 */
export function reserveScheduleState(tiers: readonly FeeTier[] | undefined) {
  if (!tiers?.length || tiers.some((tier) => tier.bps === undefined)) return 'unknown' as const;
  return tiers.some((tier) => (tier.bps ?? 0) > 0) ? ('charged' as const) : ('zero' as const);
}

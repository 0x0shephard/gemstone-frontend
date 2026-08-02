import type { DemandInput } from './valuationMath.ts';

/**
 * Turns observed bids into the demand counts the pricing engine consumes.
 *
 * Free of `npm:` specifiers so it is unit-testable outside Deno, matching the
 * split used by `valuationMath.ts` and `mvpPricingMath.ts`.
 */

export interface BidObservation {
  gemId: string;
  bidder: string;
  /** Block timestamp, ISO 8601. */
  observedAt: string;
  shape?: string | null;
  color?: string | null;
  colorGrade?: string | null;
}

/**
 * `per-bid` is the literal reading of the source matrix: "demand shall equal
 * number of bids". `per-bidder-per-gem` counts each bidder once per stone, which
 * stops a two-party bidding war on a single lot from dominating a criterion.
 */
export type CountingMode = 'per-bid' | 'per-bidder-per-gem';

export interface AggregateOptions {
  /** Only bids at or after this instant are counted. */
  since?: Date;
  mode?: CountingMode;
}

/** Must match the engine's normalisation, or lookups miss and demand reads as zero. */
const normalize = (value: string): string => value.trim().toLowerCase();

const CRITERIA = [
  ['shape', 'shape'],
  ['color', 'color'],
  ['colorGrade', 'colorGrade'],
] as const;

/**
 * Aggregates observations into per-criterion counts.
 *
 * Absent attributes are skipped rather than counted under an "unknown" key: a
 * bid on a stone whose colour grade was never recorded is not evidence about any
 * colour grade.
 */
export function aggregateDemand(
  bids: readonly BidObservation[],
  options: AggregateOptions = {},
): DemandInput {
  const mode = options.mode ?? 'per-bid';
  const sinceMs = options.since?.getTime();

  const counts: Record<string, Record<string, number>> = {
    shape: {},
    color: {},
    colorGrade: {},
  };
  const seen = new Set<string>();

  for (const bid of bids) {
    if (sinceMs !== undefined) {
      const observed = Date.parse(bid.observedAt);
      if (Number.isNaN(observed) || observed < sinceMs) continue;
    }

    for (const [criterion, field] of CRITERIA) {
      const raw = bid[field];
      if (raw === undefined || raw === null || raw.trim() === '') continue;
      const choice = normalize(raw);

      if (mode === 'per-bidder-per-gem') {
        const key = `${criterion}:${bid.gemId}:${normalize(bid.bidder)}:${choice}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }

      counts[criterion][choice] = (counts[criterion][choice] ?? 0) + 1;
    }
  }

  return {
    shape: counts.shape,
    color: counts.color,
    colorGrade: counts.colorGrade,
  };
}

/** Total observations recorded for a criterion, for reporting. */
export function totalFor(demand: DemandInput, criterion: keyof DemandInput): number {
  return Object.values(demand[criterion] ?? {}).reduce((sum, count) => sum + count, 0);
}

export interface ScanRange {
  from: bigint;
  to: bigint;
}

/**
 * Splits a block span into provider-safe `eth_getLogs` chunks.
 *
 * Providers cap the span per request, commonly at 1,000 blocks. Chunk width only
 * ever ratchets down on rejection — growing back into a width the provider has
 * already refused makes every successful chunk cost a second, failing request.
 */
export function planScanRanges(from: bigint, to: bigint, maxSpan: bigint): ScanRange[] {
  if (maxSpan <= 0n) throw new Error('Scan span must be positive');
  const ranges: ScanRange[] = [];
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + maxSpan - 1n > to ? to : cursor + maxSpan - 1n;
    ranges.push({ from: cursor, to: end });
    cursor = end + 1n;
  }
  return ranges;
}

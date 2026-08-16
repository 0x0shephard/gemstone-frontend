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

/**
 * The span a provider says it will accept, read out of its rejection.
 *
 * Providers that cap `eth_getLogs` nearly always name their limit in the error,
 * and taking them at their word beats halving blindly — halving from 1,000 to a
 * 10-block cap costs seven wasted round trips per chunk, on every chunk.
 *
 * Three phrasings seen in the wild:
 *   Alchemy    "…up to a 10 block range. …this block range should work:
 *               [0xad10d9, 0xad10e2]"
 *   thirdweb   "Maximum allowed number of requested blocks is 1000"
 *   dRPC       "ranges over 10000 blocks are not supported on free plan"
 */
export function suggestedSpan(message: string): bigint | null {
  // An explicit range the provider offers is the most reliable signal: it is
  // the only form that cannot be confused with some other number in the text.
  const offered = message.match(/\[\s*(0x[0-9a-f]+)\s*,\s*(0x[0-9a-f]+)\s*\]/i);
  if (offered) {
    const span = BigInt(offered[2]) - BigInt(offered[1]) + 1n;
    if (span > 0n) return span;
  }
  const stated =
    message.match(/(\d+)\s*[- ]?block\s*range/i) ??
    message.match(/blocks?\s+is\s+(\d+)/i) ??
    message.match(/(?:over|exceeds?|above)\s+(\d+)\s+blocks/i);
  if (stated) {
    const span = BigInt(stated[1]);
    if (span > 0n) return span;
  }
  return null;
}

/**
 * Whether a rejection is about rate rather than range.
 *
 * These two failures look alike and need opposite responses. A range cap is
 * answered by asking for less at once; a rate limit is answered by asking less
 * often, and narrowing the span makes it strictly worse — the same blocks then
 * take more requests, which is the thing being limited.
 *
 * Wording seen from providers: "exceeded its compute units per second
 * capacity" (Alchemy), "Too Many Requests", plain 429s.
 */
export function isRateLimited(message: string): boolean {
  return /rate ?limit|too many requests|\b429\b|compute units|exceeded its .*capacity|throughput|capacity/i.test(
    message,
  );
}

/**
 * The next width to try after a rejected chunk, or `null` when out of room.
 *
 * Returning `null` at a width of one block is what stops a provider outage from
 * being mistaken for a range cap and retried forever.
 */
export function narrowedSpan(current: bigint, message: string): bigint | null {
  if (current <= 1n) return null;
  const suggested = suggestedSpan(message);
  // Only ever narrower. A provider naming a limit wider than what it just
  // refused is describing a different constraint — response size, say — and
  // widening on a rejection would loop.
  if (suggested !== null && suggested < current) return suggested;
  const halved = current / 2n;
  return halved < 1n ? 1n : halved;
}

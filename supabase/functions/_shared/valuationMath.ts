import {
  PPM,
  VALUATION_MATRIX,
  type CaratAnchor,
  type ValuationMatrix,
} from './valuationMatrix.ts';

/**
 * Gemstone pricing engine.
 *
 * Deliberately free of `npm:` specifiers so the arithmetic that decides a
 * permanent on-chain valuation is unit-testable outside Deno, matching the
 * `mvpPricingMath.ts` split.
 *
 * Every value is an integer. The output is committed by `valuationHash`, so the
 * same inputs must produce byte-identical results on every run and on every
 * machine; floating point would not guarantee that.
 *
 *   NFT price = base gem value x market preference multipliers
 *   base      = Pvariety x Mcarat x Mclarity x Mtreatment
 */

const USD_DECIMALS = 10n ** 18n;
const MICRO_CARAT = 1_000_000n;

/** Demand counts for one criterion, keyed by choice. Missing keys count as zero. */
export type DemandCounts = Readonly<Record<string, number>>;

export interface ValuationInput {
  variety: string;
  caratWeight: number;
  clarity: string;
  treatment: string;
  shape: string;
  color: string;
  colorGrade: string;
}

export interface DemandInput {
  shape?: DemandCounts;
  color?: DemandCounts;
  colorGrade?: DemandCounts;
}

export interface MultiplierDetail {
  criterion: 'shape' | 'color' | 'colorGrade';
  choice: string;
  /** Choices available for this criterion — the `N` in the source formula. */
  choiceCount: number;
  observed: number;
  totalObserved: number;
  /** Smoothed share, ppm. */
  sharePpm: bigint;
  /** Multiplier before clamping, ppm. */
  rawPpm: bigint;
  /** Multiplier actually applied, ppm. */
  multiplierPpm: bigint;
  clamped: boolean;
}

export interface Valuation {
  matrixVersion: string;
  basePricePerCaratUsd: bigint;
  caratMultiplierPpm: bigint;
  clarityMultiplierPpm: bigint;
  treatmentMultiplierPpm: bigint;
  /** Pvariety x Mcarat x Mclarity x Mtreatment, 18-decimal USD. */
  baseValueUsd: bigint;
  marketMultipliers: MultiplierDetail[];
  /** Clamped product of the market multipliers, ppm. */
  marketMultiplierPpm: bigint;
  /** Final price, 18-decimal USD, rounded up to whole USD. */
  priceUsd: bigint;
  priceClamped: boolean;
}

class ValuationError extends Error {}

/** Refuses rather than guesses: an unpriceable input must never reach the chain. */
function reject(message: string): never {
  throw new ValuationError(message);
}

const normalize = (value: string): string => value.trim().toLowerCase();

function ceilDiv(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

function clamp(value: bigint, min: bigint, max: bigint): bigint {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Carat multiplier, linearly interpolated between the published anchors.
 *
 * Outside the anchor range the engine refuses. The curve is exponential by
 * design, so extrapolating past the last anchor compounds error quickly, and the
 * result is written to a field with no setter.
 */
export function caratMultiplierPpm(
  microCarats: bigint,
  anchors: readonly CaratAnchor[] = VALUATION_MATRIX.caratAnchors,
): bigint {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (microCarats < first.microCarats || microCarats > last.microCarats) {
    reject(
      `Carat weight is outside the priced range ${Number(first.microCarats) / 1e6}–${
        Number(last.microCarats) / 1e6
      } ct. Extend the matrix carat table before pricing this stone.`,
    );
  }
  for (let index = 1; index < anchors.length; index += 1) {
    const lower = anchors[index - 1];
    const upper = anchors[index];
    if (microCarats > upper.microCarats) continue;
    const span = upper.microCarats - lower.microCarats;
    if (span === 0n) return lower.multiplierPpm;
    const offset = microCarats - lower.microCarats;
    const rise = upper.multiplierPpm - lower.multiplierPpm;
    return lower.multiplierPpm + (rise * offset) / span;
  }
  return last.multiplierPpm;
}

/**
 * Market preference multiplier for one criterion.
 *
 *   share = (observed + prior) / (total + prior x N)
 *   M     = 1 + delta x ((share - 1/N) / (1/N))
 *         = 1 + delta x (share x N - 1)
 *
 * The second form is what is computed: it avoids dividing by `1/N` and keeps the
 * whole calculation in integers. The Laplace prior is what makes an unobserved
 * choice sit at 1.0 instead of the floor — without it, a newly offered shape is
 * penalised purely for being new.
 */
export function marketMultiplier(
  criterion: MultiplierDetail['criterion'],
  choice: string,
  choices: readonly string[],
  counts: DemandCounts,
  matrix: ValuationMatrix = VALUATION_MATRIX,
): MultiplierDetail {
  const normalizedChoice = normalize(choice);
  if (!choices.some((candidate) => normalize(candidate) === normalizedChoice)) {
    reject(`"${choice}" is not a known ${criterion} in matrix ${matrix.version}`);
  }

  const choiceCount = BigInt(choices.length);
  const prior = matrix.demandPriorCount;
  const observed = BigInt(Math.max(0, Math.trunc(counts[normalizedChoice] ?? 0)));
  const totalObserved = choices.reduce(
    (sum, candidate) => sum + BigInt(Math.max(0, Math.trunc(counts[normalize(candidate)] ?? 0))),
    0n,
  );

  const denominator = totalObserved + prior * choiceCount;
  // share x N, in ppm.
  const shareTimesNPpm = (PPM * choiceCount * (observed + prior)) / denominator;
  const sharePpm = shareTimesNPpm / choiceCount;

  const delta = matrix.deltaPpm[criterion];
  const rawPpm = PPM + (delta * (shareTimesNPpm - PPM)) / PPM;
  const multiplierPpm = clamp(rawPpm, matrix.criterionClampPpm.min, matrix.criterionClampPpm.max);

  return {
    criterion,
    choice: normalizedChoice,
    choiceCount: choices.length,
    observed: Number(observed),
    totalObserved: Number(totalObserved),
    sharePpm,
    rawPpm,
    multiplierPpm,
    clamped: multiplierPpm !== rawPpm,
  };
}

/**
 * Prices a graded stone.
 *
 * Throws on anything the matrix cannot price. Callers must treat a throw as a
 * hard stop, never as a reason to fall back to a default figure.
 */
export function calculateValuation(
  input: ValuationInput,
  demand: DemandInput = {},
  matrix: ValuationMatrix = VALUATION_MATRIX,
): Valuation {
  const varietyKey = normalize(input.variety);
  const variety = matrix.varieties[varietyKey];
  if (!variety) {
    reject(
      `No base price per carat is configured for "${input.variety}" in matrix ${matrix.version}`,
    );
  }

  if (!Number.isFinite(input.caratWeight) || input.caratWeight <= 0) {
    reject('Carat weight must be a positive number');
  }
  const microCarats = BigInt(Math.round(input.caratWeight * Number(MICRO_CARAT)));

  const clarityKey = normalize(input.clarity);
  const clarityMultiplierPpm = matrix.clarityPpm[clarityKey];
  if (clarityMultiplierPpm === undefined) {
    reject(`"${input.clarity}" is not a known clarity grade in matrix ${matrix.version}`);
  }

  const treatmentKey = normalize(input.treatment);
  const treatmentMultiplierPpm = matrix.treatmentPpm[treatmentKey];
  if (treatmentMultiplierPpm === undefined) {
    reject(`"${input.treatment}" is not a known treatment in matrix ${matrix.version}`);
  }

  const caratPpm = caratMultiplierPpm(microCarats, matrix.caratAnchors);

  // One division at the end keeps every intermediate at full precision.
  const baseValueUsd =
    (variety.basePricePerCaratUsd *
      USD_DECIMALS *
      caratPpm *
      clarityMultiplierPpm *
      treatmentMultiplierPpm) /
    (PPM * PPM * PPM);

  const marketMultipliers = [
    marketMultiplier('shape', input.shape, matrix.shapes, demand.shape ?? {}, matrix),
    marketMultiplier('color', input.color, variety.colors, demand.color ?? {}, matrix),
    marketMultiplier(
      'colorGrade',
      input.colorGrade,
      variety.colorGrades,
      demand.colorGrade ?? {},
      matrix,
    ),
  ];

  const productPpm = marketMultipliers.reduce(
    (product, detail) => (product * detail.multiplierPpm) / PPM,
    PPM,
  );
  const marketMultiplierPpm = clamp(productPpm, matrix.totalClampPpm.min, matrix.totalClampPpm.max);

  const rawPriceUsd = (baseValueUsd * marketMultiplierPpm) / PPM;
  // Whole USD, rounded up, matching the existing MVP pricing convention.
  const wholeUsd = ceilDiv(rawPriceUsd, USD_DECIMALS);
  const clampedUsd = clamp(wholeUsd, matrix.priceClampUsd.min, matrix.priceClampUsd.max);

  return {
    matrixVersion: matrix.version,
    basePricePerCaratUsd: variety.basePricePerCaratUsd,
    caratMultiplierPpm: caratPpm,
    clarityMultiplierPpm,
    treatmentMultiplierPpm,
    baseValueUsd,
    marketMultipliers,
    marketMultiplierPpm,
    priceUsd: clampedUsd * USD_DECIMALS,
    priceClamped: clampedUsd !== wholeUsd,
  };
}

export { ValuationError };

/**
 * Versioned gemstone valuation matrix.
 *
 * `GemRegistry.verifyGem` records a `valuationMatrixHash` committing to "the exact
 * pricing matrix/version used". This document is that matrix: it is canonicalised
 * and hashed, the hash goes on-chain, and a gem priced under one version stays
 * reproducible after the matrix changes.
 *
 * Changing any value here is a pricing change. Bump `version` when you do, so
 * historical valuations keep resolving to the matrix that produced them.
 *
 * Multipliers are parts-per-million (`1_000_000` = 1.0) so the engine can price
 * entirely in integers. Floating point anywhere in this path would make the same
 * inputs hash differently between runs.
 */

import { VALUATION_MATRIX_V1 } from './valuationMatrixV1.ts';
import { VALUATION_MATRIX_V2 } from './valuationMatrixV2.ts';

export const PPM = 1_000_000n;

/** A point on the carat curve: weight in micro-carats, multiplier in ppm. */
export interface CaratAnchor {
  microCarats: bigint;
  multiplierPpm: bigint;
}

export interface VarietySpec {
  /** Base price per carat, whole USD. Omit a variety entirely if it has no agreed price. */
  basePricePerCaratUsd: bigint;
  /** Colour choices. `N` for the colour criterion; a single colour makes the multiplier exactly 1.0. */
  colors: readonly string[];
  /** Colour-grade choices for this variety. */
  colorGrades: readonly string[];
}

export interface ValuationMatrix {
  version: string;
  varieties: Readonly<Record<string, VarietySpec>>;
  caratAnchors: readonly CaratAnchor[];
  clarityPpm: Readonly<Record<string, bigint>>;
  treatmentPpm: Readonly<Record<string, bigint>>;
  shapes: readonly string[];
  /** How strongly demand moves price, per variable criterion. */
  deltaPpm: Readonly<Record<'shape' | 'color' | 'colorGrade', bigint>>;
  /** Laplace prior. `1` keeps an unobserved choice at a neutral 1.0 rather than the floor. */
  demandPriorCount: bigint;
  /** Bounds on a single market multiplier. */
  criterionClampPpm: { min: bigint; max: bigint };
  /** Bound on the product of all market multipliers, so they cannot compound. */
  totalClampPpm: { min: bigint; max: bigint };
  /** Final price bounds, whole USD. */
  priceClampUsd: { min: bigint; max: bigint };
}

/**
 * Matrix v3 applies the September 2026 valuation table supplied by the product
 * owner. Historical v1 and v2 values remain frozen in their archive modules.
 *
 *  1. Six varieties are priced; anything else is refused rather than guessed.
 *  2. The multiplier table is authoritative where the source document's worked
 *     example disagrees with it — 2ct is 2.4, not the 2.24 the example computes.
 *     The tests record the difference so the choice stays visible.
 *  3. Carats are priced from 0.5 to 30.0. The multiplier rises through the
 *     published anchors and remains 9.0 from 5–30 ct.
 *  4. Delta is 0.5 for all three variable criteria. The source specifies it only
 *     for shape; colour and colour grade reuse the same strength.
 *  5. Clamps bound a single market multiplier to 0.75–1.30 and their product to
 *     0.70–1.50. Without them one dominant choice among ten reaches 5.5x.
 *  6. Treatment is a single axis, exactly as the source lists it. Heat and oil do
 *     not stack.
 *
 * Two mechanical notes:
 *
 *  - Colour sets are specified in the source only for Emerald and Sapphire. Ruby
 *    and Peridot declare their single characteristic colour, which is
 *    mathematically inert: with N = 1 the colour multiplier is always exactly
 *    1.0, so this asserts nothing about their pricing.
 *  - Colour grades outside Emerald use the generic Dark/Medium/Light triple,
 *    following the source note that most gemstone colours have three gradings.
 */
export const VALUATION_MATRIX: ValuationMatrix = {
  version: 'digital-carat-matrix-v3',

  varieties: {
    emerald: {
      basePricePerCaratUsd: 1_000n,
      colors: ['green'],
      colorGrades: ['bluish green', 'deep green', 'light green'],
    },
    sapphire: {
      basePricePerCaratUsd: 1_200n,
      colors: [
        'blue',
        'purple',
        'gray',
        'green',
        'brown',
        'orange',
        'pink',
        'violet',
        'white',
        'yellow',
      ],
      colorGrades: ['dark', 'medium', 'light'],
    },
    ruby: {
      basePricePerCaratUsd: 1_500n,
      colors: ['red'],
      colorGrades: ['dark', 'medium', 'light'],
    },
    peridot: {
      basePricePerCaratUsd: 200n,
      colors: ['green'],
      colorGrades: ['dark', 'medium', 'light'],
    },
    /*
     * Added in v2. Both carry several colours, which is a pricing decision and
     * not a labelling one: with N = 1 the colour multiplier is pinned at exactly
     * 1.0, while N > 1 makes colour a demand-driven variable that moves the
     * final figure. Tourmaline's eight-colour range therefore gives colour real
     * weight in its price, as sapphire's ten already do.
     *
     * Colour grades were not specified for either, so both take the generic
     * dark/medium/light triple used everywhere except emerald.
     */
    tourmaline: {
      basePricePerCaratUsd: 400n,
      colors: [
        'blue',
        'bluish green',
        'greenish blue',
        'orangey red',
        'pink',
        'pinkish red',
        'red',
        'watermelon',
      ],
      colorGrades: ['dark', 'medium', 'light'],
    },
    aquamarine: {
      basePricePerCaratUsd: 300n,
      colors: ['blue', 'deep blue', 'greenish blue'],
      colorGrades: ['dark', 'medium', 'light'],
    },
  },

  // 0.5 -> 0.55, 1 -> 1.00, 2 -> 2.40, 3 -> 4.20, 5–30 -> 9.00
  caratAnchors: [
    { microCarats: 500_000n, multiplierPpm: 550_000n },
    { microCarats: 1_000_000n, multiplierPpm: 1_000_000n },
    { microCarats: 2_000_000n, multiplierPpm: 2_400_000n },
    { microCarats: 3_000_000n, multiplierPpm: 4_200_000n },
    { microCarats: 5_000_000n, multiplierPpm: 9_000_000n },
    { microCarats: 30_000_000n, multiplierPpm: 9_000_000n },
  ],

  clarityPpm: {
    dcl: 50_000n,
    i3: 200_000n,
    i2: 300_000n,
    i1: 500_000n,
    si2: 750_000n,
    si1: 1_000_000n,
    vs: 1_150_000n,
    vvs: 1_450_000n,
  },

  treatmentPpm: {
    heated: 600_000n,
    'minor heat': 850_000n,
    unheated: 1_200_000n,
    oiled: 750_000n,
    'no oil': 1_150_000n,
  },

  shapes: [
    'cabochon',
    'cushion',
    'emerald cut',
    'marquise',
    'oval',
    'pear',
    'round',
    'diamond cut',
  ],

  deltaPpm: { shape: 500_000n, color: 500_000n, colorGrade: 500_000n },

  demandPriorCount: 1n,

  criterionClampPpm: { min: 750_000n, max: 1_300_000n },
  totalClampPpm: { min: 700_000n, max: 1_500_000n },
  priceClampUsd: { min: 100n, max: 250_000n },
};

export interface MatrixOptions {
  version: string;
  varieties: Array<{ name: string; colors: string[]; colorGrades: string[] }>;
  clarities: string[];
  treatments: string[];
  shapes: string[];
  caratRange: { min: number; max: number };
}

/**
 * The choices a grading form may offer, derived from the matrix rather than
 * restated.
 *
 * A hardcoded dropdown drifts silently: the grader picks a value the engine has
 * no price for and the refusal arrives after they have already assessed the
 * stone. Serving the options from the same document that prices them makes an
 * unpriceable selection unreachable.
 */
/*
 * Every version ever used to price a gem, newest first.
 *
 * `GemRegistry.verifyGem` writes a hash of the matrix into a field with no
 * setter, so a gem's commitment is permanent. Replacing the matrix in place
 * would leave those hashes pointing at a document that exists only in git
 * history — the commitment would still be recorded and no longer checkable.
 * Keeping the superseded versions here is what makes "resolvable to the rules
 * that produced it" true rather than aspirational.
 */
const MATRIX_VERSIONS: readonly ValuationMatrix[] = [
  VALUATION_MATRIX,
  VALUATION_MATRIX_V2,
  VALUATION_MATRIX_V1,
];

/** Thrown when a stored valuation names a matrix this build does not carry. */
export class UnknownMatrixVersionError extends Error {
  constructor(version: string) {
    super(`Unknown valuation matrix version: ${version}`);
    this.name = 'UnknownMatrixVersionError';
  }
}

/**
 * The matrix a given valuation was priced under.
 *
 * Refuses rather than falling back to the current version: silently re-pricing
 * a historical gem under today's rules would produce a figure that disagrees
 * with the immutable one on-chain, and look authoritative doing it.
 */
export function matrixForVersion(version: string): ValuationMatrix {
  const matrix = MATRIX_VERSIONS.find((candidate) => candidate.version === version);
  if (!matrix) throw new UnknownMatrixVersionError(version);
  return matrix;
}

export function matrixOptions(matrix: ValuationMatrix = VALUATION_MATRIX): MatrixOptions {
  const anchors = matrix.caratAnchors;
  return {
    version: matrix.version,
    varieties: Object.entries(matrix.varieties).map(([name, spec]) => ({
      name,
      colors: [...spec.colors],
      colorGrades: [...spec.colorGrades],
    })),
    clarities: Object.keys(matrix.clarityPpm),
    treatments: Object.keys(matrix.treatmentPpm),
    shapes: [...matrix.shapes],
    caratRange: {
      min: Number(anchors[0].microCarats) / 1_000_000,
      max: Number(anchors[anchors.length - 1].microCarats) / 1_000_000,
    },
  };
}

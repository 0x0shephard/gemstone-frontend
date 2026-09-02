import type { ValuationMatrix } from './valuationMatrix.ts';

/**
 * Frozen archive of `digital-carat-matrix-v2`.
 *
 * Gems already verified under v2 carry a permanent on-chain hash of these
 * values. Never edit this object; publish any pricing change as a new version.
 */
export const VALUATION_MATRIX_V2: ValuationMatrix = {
  version: 'digital-carat-matrix-v2',
  varieties: {
    emerald: {
      basePricePerCaratUsd: 1_000n,
      colors: ['green'],
      colorGrades: ['bluish green', 'deep green', 'light green'],
    },
    sapphire: {
      basePricePerCaratUsd: 2_000n,
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
    tourmaline: {
      basePricePerCaratUsd: 200n,
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
      basePricePerCaratUsd: 150n,
      colors: ['blue', 'deep blue', 'greenish blue'],
      colorGrades: ['dark', 'medium', 'light'],
    },
  },
  caratAnchors: [
    { microCarats: 500_000n, multiplierPpm: 550_000n },
    { microCarats: 1_000_000n, multiplierPpm: 1_000_000n },
    { microCarats: 2_000_000n, multiplierPpm: 2_400_000n },
    { microCarats: 3_000_000n, multiplierPpm: 4_200_000n },
    { microCarats: 5_000_000n, multiplierPpm: 9_000_000n },
  ],
  clarityPpm: {
    dcl: 200_000n,
    i3: 600_000n,
    i2: 700_000n,
    i1: 800_000n,
    si2: 950_000n,
    si1: 1_050_000n,
    vs: 1_200_000n,
    vvs: 1_450_000n,
  },
  treatmentPpm: {
    heated: 900_000n,
    'minor heat': 970_000n,
    unheated: 1_200_000n,
    oiled: 950_000n,
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

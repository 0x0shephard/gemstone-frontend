import { describe, expect, it } from 'vitest';
import {
  calculateValuation,
  caratMultiplierPpm,
  marketMultiplier,
  type DemandInput,
} from './valuationMath.ts';
import { PPM, VALUATION_MATRIX } from './valuationMatrix.ts';

const USD = 10n ** 18n;
const usd = (value: Valuation['priceUsd']) => Number(value / USD);
type Valuation = ReturnType<typeof calculateValuation>;

/** The stone from the source document's worked example. */
const EXAMPLE = {
  variety: 'emerald',
  caratWeight: 2,
  clarity: 'VVS',
  treatment: 'unheated',
  shape: 'cabochon',
  color: 'green',
  colorGrade: 'light green',
};

/**
 * Shape demand from the source document: 1,000 total bids across eight shapes,
 * with four named. The remainder is assigned to the unnamed shapes so the totals
 * reconcile the way the document's own arithmetic assumes.
 */
const DOCUMENT_SHAPE_DEMAND: DemandInput = {
  shape: {
    cabochon: 120,
    'diamond cut': 160,
    oval: 90,
    pear: 70,
    cushion: 140,
    'emerald cut': 140,
    marquise: 140,
    round: 140,
  },
};

describe('carat multiplier', () => {
  it('matches the published anchors exactly', () => {
    const anchors: Array<[number, bigint]> = [
      [0.5, 550_000n],
      [1, 1_000_000n],
      [2, 2_400_000n],
      [3, 4_200_000n],
      [5, 9_000_000n],
    ];
    for (const [carat, expected] of anchors) {
      expect(caratMultiplierPpm(BigInt(carat * 1e6))).toBe(expected);
    }
  });

  it('interpolates between anchors', () => {
    // Midway between 1.0 -> 1.0 and 2.0 -> 2.4.
    expect(caratMultiplierPpm(1_500_000n)).toBe(1_700_000n);
  });

  it('refuses weights outside the priced range instead of extrapolating', () => {
    expect(() => caratMultiplierPpm(6_000_000n)).toThrow(/outside the priced range/i);
    expect(() => caratMultiplierPpm(100_000n)).toThrow(/outside the priced range/i);
  });
});

describe('market preference multipliers', () => {
  it('reproduces the shape multipliers from the source document', () => {
    // The document computes these without smoothing; with 1,000 observations the
    // Laplace prior moves each by well under a percentage point.
    const expected: Record<string, number> = {
      cabochon: 0.98,
      'diamond cut': 1.14,
      oval: 0.86,
      pear: 0.78,
    };
    for (const [shape, value] of Object.entries(expected)) {
      const detail = marketMultiplier(
        'shape',
        shape,
        VALUATION_MATRIX.shapes,
        DOCUMENT_SHAPE_DEMAND.shape!,
      );
      expect(Number(detail.rawPpm) / 1e6).toBeCloseTo(value, 2);
    }
  });

  it('starts an unobserved criterion at neutral rather than the floor', () => {
    const detail = marketMultiplier('shape', 'round', VALUATION_MATRIX.shapes, {});
    expect(detail.multiplierPpm).toBe(PPM);
    expect(detail.clamped).toBe(false);
  });

  it('is exactly neutral when a criterion has only one choice', () => {
    const detail = marketMultiplier('color', 'green', ['green'], { green: 900 });
    expect(detail.multiplierPpm).toBe(PPM);
  });

  it('clamps a runaway multiplier', () => {
    // One colour taking essentially all demand across ten choices would otherwise
    // reach 5.5x on the raw formula.
    const detail = marketMultiplier('color', 'blue', VALUATION_MATRIX.varieties.sapphire.colors, {
      blue: 10_000,
    });
    expect(detail.rawPpm).toBeGreaterThan(VALUATION_MATRIX.criterionClampPpm.max);
    expect(detail.multiplierPpm).toBe(VALUATION_MATRIX.criterionClampPpm.max);
    expect(detail.clamped).toBe(true);
  });

  it('rejects a choice the matrix does not define', () => {
    expect(() => marketMultiplier('shape', 'trillion', VALUATION_MATRIX.shapes, {})).toThrow(
      /not a known shape/i,
    );
  });
});

describe('base gem value', () => {
  it('multiplies variety, carat, clarity and treatment', () => {
    // 1,000 x 2.4 x 1.45 x 1.20 = 4,176
    const valuation = calculateValuation(EXAMPLE);
    expect(valuation.baseValueUsd).toBe(4_176n * USD);
  });

  /**
   * The source document's example computes the same stone as
   * 1,000 x 2.24 x 1.45 x 1.20 = 3,897, using 2.24 where its own multiplier table
   * says 2.40. The table is authoritative by decision; this records the size of
   * the difference so the choice stays visible rather than buried.
   */
  it('follows the multiplier table, not the worked example', () => {
    const fromTable = 4_176;
    const fromWorkedExample = 3_897;
    expect(usd(calculateValuation(EXAMPLE).baseValueUsd)).toBe(fromTable);
    expect(fromTable - fromWorkedExample).toBe(279);
  });
});

describe('full valuation', () => {
  it('applies market multipliers on top of the base value', () => {
    const valuation = calculateValuation(EXAMPLE, DOCUMENT_SHAPE_DEMAND);
    // Emerald has one colour, so Mcolor is exactly 1.0 and only shape and colour
    // grade can move the price.
    const colorDetail = valuation.marketMultipliers.find((m) => m.criterion === 'color');
    expect(colorDetail?.multiplierPpm).toBe(PPM);
    expect(valuation.marketMultiplierPpm).toBeLessThan(PPM);
    expect(usd(valuation.priceUsd)).toBeLessThan(usd(valuation.baseValueUsd));
  });

  it('is neutral overall with no demand data at all', () => {
    const valuation = calculateValuation(EXAMPLE);
    expect(valuation.marketMultiplierPpm).toBe(PPM);
    expect(valuation.priceUsd).toBe(valuation.baseValueUsd);
  });

  it('is deterministic', () => {
    const a = calculateValuation(EXAMPLE, DOCUMENT_SHAPE_DEMAND);
    const b = calculateValuation(EXAMPLE, DOCUMENT_SHAPE_DEMAND);
    expect(a.priceUsd).toBe(b.priceUsd);
    expect(a.baseValueUsd).toBe(b.baseValueUsd);
  });

  it('prices every configured variety', () => {
    for (const variety of Object.keys(VALUATION_MATRIX.varieties)) {
      const spec = VALUATION_MATRIX.varieties[variety];
      const valuation = calculateValuation({
        ...EXAMPLE,
        variety,
        color: spec.colors[0],
        colorGrade: spec.colorGrades[0],
      });
      expect(valuation.priceUsd).toBeGreaterThan(0n);
    }
  });
});

describe('refusal paths', () => {
  it('refuses a variety with no agreed base price', () => {
    for (const variety of ['tourmaline', 'aquamarine']) {
      expect(() => calculateValuation({ ...EXAMPLE, variety })).toThrow(/no base price per carat/i);
    }
  });

  it('refuses unknown clarity and treatment', () => {
    expect(() => calculateValuation({ ...EXAMPLE, clarity: 'flawless' })).toThrow(
      /not a known clarity/i,
    );
    expect(() => calculateValuation({ ...EXAMPLE, treatment: 'irradiated' })).toThrow(
      /not a known treatment/i,
    );
  });

  it('refuses a colour the variety does not have', () => {
    expect(() => calculateValuation({ ...EXAMPLE, color: 'blue' })).toThrow(/not a known color/i);
  });

  it('refuses a non-positive carat weight', () => {
    expect(() => calculateValuation({ ...EXAMPLE, caratWeight: 0 })).toThrow(/positive number/i);
  });
});

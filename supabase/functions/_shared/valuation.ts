import { canonicalize } from 'npm:json-canonicalize@1.1.0';
import { keccak256, toBytes, type Hash } from 'npm:viem@2';
import { createCommitment } from './commitment.ts';
import {
  calculateValuation,
  type DemandInput,
  type ValuationInput,
  type Valuation,
} from './valuationMath.ts';
import { VALUATION_MATRIX, type ValuationMatrix } from './valuationMatrix.ts';

/**
 * Turns a graded stone into the three values `GemRegistry.verifyGem` records:
 * `approvedValuationUsd`, `valuationHash` and `valuationMatrixHash`.
 *
 * The commitment captures the demand counts as well as the result. `valuationHash`
 * is a promise that this decision can be re-derived, and bid counts move — without
 * the snapshot the promise is unkeepable.
 */

export const VALUATION_METHOD = 'matrix-v1';

/** JSON-safe view of the matrix. `bigint` cannot be serialised, and the hash must be stable. */
function serialisableMatrix(matrix: ValuationMatrix): unknown {
  return JSON.parse(
    JSON.stringify(matrix, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
  );
}

/**
 * Commitment to the exact pricing rules used. Changing any matrix value changes
 * this hash, which is what keeps a historical valuation resolvable to the rules
 * that produced it.
 */
export function valuationMatrixHash(matrix: ValuationMatrix = VALUATION_MATRIX): Hash {
  return keccak256(toBytes(canonicalize(serialisableMatrix(matrix))));
}

/** Multiplier breakdown in a form safe to store and display. */
function serialisableBreakdown(valuation: Valuation) {
  return {
    basePricePerCaratUsd: valuation.basePricePerCaratUsd.toString(),
    caratMultiplierPpm: valuation.caratMultiplierPpm.toString(),
    clarityMultiplierPpm: valuation.clarityMultiplierPpm.toString(),
    treatmentMultiplierPpm: valuation.treatmentMultiplierPpm.toString(),
    baseValueUsd: valuation.baseValueUsd.toString(),
    marketMultiplierPpm: valuation.marketMultiplierPpm.toString(),
    marketMultipliers: valuation.marketMultipliers.map((detail) => ({
      criterion: detail.criterion,
      choice: detail.choice,
      choiceCount: detail.choiceCount,
      observed: detail.observed,
      totalObserved: detail.totalObserved,
      sharePpm: detail.sharePpm.toString(),
      rawPpm: detail.rawPpm.toString(),
      multiplierPpm: detail.multiplierPpm.toString(),
      clamped: detail.clamped,
    })),
    priceClamped: valuation.priceClamped,
  };
}

export interface GradedValuation {
  method: string;
  matrixVersion: string;
  approvedValuationUsd: bigint;
  valuationHash: Hash;
  valuationMatrixHash: Hash;
  canonicalPayload: string;
  nonce: `0x${string}`;
  breakdown: ReturnType<typeof serialisableBreakdown>;
}

/**
 * Prices a lab-graded stone and produces its on-chain commitment.
 *
 * `calculateValuation` throws on anything the matrix cannot price. That throw is
 * a hard stop: the caller must abort verification rather than substitute a
 * default, because `approvedValuationUsd` has no setter once recorded.
 */
export function createGradedValuation(input: {
  submissionId: string;
  gradedBy: string;
  graded: ValuationInput;
  demand?: DemandInput;
  matrix?: ValuationMatrix;
}): GradedValuation {
  const matrix = input.matrix ?? VALUATION_MATRIX;
  const valuation = calculateValuation(input.graded, input.demand ?? {}, matrix);
  const breakdown = serialisableBreakdown(valuation);

  const commitment = createCommitment({
    schemaVersion: 'digital-carat-valuation/v2',
    method: VALUATION_METHOD,
    matrixVersion: valuation.matrixVersion,
    submissionId: input.submissionId,
    gradedBy: input.gradedBy,
    gradedAttributes: { ...input.graded },
    demandSnapshot: input.demand ?? {},
    approvedValuationUsd: valuation.priceUsd.toString(),
    breakdown,
    timestamp: new Date().toISOString(),
  });

  return {
    method: VALUATION_METHOD,
    matrixVersion: valuation.matrixVersion,
    approvedValuationUsd: valuation.priceUsd,
    valuationHash: commitment.hash,
    valuationMatrixHash: valuationMatrixHash(matrix),
    canonicalPayload: commitment.canonicalPayload,
    nonce: commitment.nonce,
    breakdown,
  };
}

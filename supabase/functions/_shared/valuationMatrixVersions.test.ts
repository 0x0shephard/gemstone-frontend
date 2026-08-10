import { describe, expect, it } from 'vitest';
import {
  matrixForVersion,
  UnknownMatrixVersionError,
  VALUATION_MATRIX,
} from './valuationMatrix.ts';
import { VALUATION_MATRIX_V1 } from './valuationMatrixV1.ts';
import { keccak256, toBytes } from 'viem';

function digest(matrix: unknown): string {
  return keccak256(
    toBytes(
      JSON.stringify(matrix, (_key, value) => (typeof value === 'bigint' ? `${value}` : value)),
    ),
  );
}

describe('matrix versioning', () => {
  it('still resolves the version the deployed gems were priced under', () => {
    expect(matrixForVersion('digital-carat-matrix-v1')).toBe(VALUATION_MATRIX_V1);
    expect(matrixForVersion(VALUATION_MATRIX.version)).toBe(VALUATION_MATRIX);
  });

  it('refuses an unknown version rather than falling back to the current one', () => {
    // Re-pricing a historical gem under today's rules would contradict the
    // immutable figure on-chain while looking authoritative.
    expect(() => matrixForVersion('digital-carat-matrix-v99')).toThrow(UnknownMatrixVersionError);
  });

  /**
   * v1 must never change. Every gem verified before Tourmaline and Aquamarine
   * carries a hash of that exact document in `valuationMatrixHash`, a field with
   * no setter — so an edit here would silently break commitments that can never
   * be rewritten.
   *
   * This is not the on-chain hash: that one is RFC 8785 canonical JSON via
   * `valuation.ts`, which imports Deno `npm:` specifiers and cannot be loaded
   * here. It is a digest over the same values, and it fails on any change to
   * them, which is the property that matters.
   */
  it('pins the archived v1 document against edits', () => {
    expect(digest(VALUATION_MATRIX_V1)).toBe(
      '0x57797490689e56a26389b8d80fc9924f4b4698649d6d9dfb16189cfa6c0f1967',
    );
  });

  it('gives v2 a different digest, since it prices differently', () => {
    expect(digest(VALUATION_MATRIX)).not.toBe(digest(VALUATION_MATRIX_V1));
  });

  it('adds the two varieties without disturbing the four that were priced', () => {
    for (const variety of ['emerald', 'sapphire', 'ruby', 'peridot'] as const) {
      expect(VALUATION_MATRIX.varieties[variety]).toEqual(VALUATION_MATRIX_V1.varieties[variety]);
    }
    expect(VALUATION_MATRIX.varieties.tourmaline.basePricePerCaratUsd).toBe(200n);
    expect(VALUATION_MATRIX.varieties.aquamarine.basePricePerCaratUsd).toBe(150n);
    expect(VALUATION_MATRIX_V1.varieties.tourmaline).toBeUndefined();
  });
});

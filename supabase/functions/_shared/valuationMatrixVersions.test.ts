import { describe, expect, it } from 'vitest';
import {
  matrixForVersion,
  UnknownMatrixVersionError,
  VALUATION_MATRIX,
} from './valuationMatrix.ts';
import { VALUATION_MATRIX_V1 } from './valuationMatrixV1.ts';
import { VALUATION_MATRIX_V2 } from './valuationMatrixV2.ts';
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
    expect(matrixForVersion('digital-carat-matrix-v2')).toBe(VALUATION_MATRIX_V2);
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

  it('pins the archived v2 document against edits', () => {
    expect(digest(VALUATION_MATRIX_V2)).toBe(
      '0x5fd2c7ce030087cc69bb3ff8b8e451585151cca559765b596f8401933b9bb4d6',
    );
  });

  it('gives the current matrix a different digest, since it prices differently', () => {
    expect(digest(VALUATION_MATRIX)).not.toBe(digest(VALUATION_MATRIX_V1));
    expect(digest(VALUATION_MATRIX)).not.toBe(digest(VALUATION_MATRIX_V2));
  });

  it('applies every base price from the v3 source matrix', () => {
    expect(VALUATION_MATRIX.varieties.emerald.basePricePerCaratUsd).toBe(1_000n);
    expect(VALUATION_MATRIX.varieties.sapphire.basePricePerCaratUsd).toBe(1_200n);
    expect(VALUATION_MATRIX.varieties.ruby.basePricePerCaratUsd).toBe(1_500n);
    expect(VALUATION_MATRIX.varieties.peridot.basePricePerCaratUsd).toBe(200n);
    expect(VALUATION_MATRIX.varieties.tourmaline.basePricePerCaratUsd).toBe(400n);
    expect(VALUATION_MATRIX.varieties.aquamarine.basePricePerCaratUsd).toBe(300n);
    expect(VALUATION_MATRIX_V1.varieties.tourmaline).toBeUndefined();
  });

  it('applies every clarity and treatment multiplier from the v3 source matrix', () => {
    expect(VALUATION_MATRIX.clarityPpm).toEqual({
      dcl: 50_000n,
      i3: 200_000n,
      i2: 300_000n,
      i1: 500_000n,
      si2: 750_000n,
      si1: 1_000_000n,
      vs: 1_150_000n,
      vvs: 1_450_000n,
    });
    expect(VALUATION_MATRIX.treatmentPpm).toEqual({
      heated: 600_000n,
      'minor heat': 850_000n,
      unheated: 1_200_000n,
      oiled: 750_000n,
      'no oil': 1_150_000n,
    });
    expect(VALUATION_MATRIX.caratAnchors.at(-1)).toEqual({
      microCarats: 30_000_000n,
      multiplierPpm: 9_000_000n,
    });
  });
});

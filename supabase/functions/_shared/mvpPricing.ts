import { canonicalize } from 'npm:json-canonicalize@1.1.0';
import { keccak256, toBytes, type Hash } from 'npm:viem@2';
import { createCommitment } from './commitment.ts';
import { calculateMvpPriceUsd, mvpPricingMatrix } from './mvpPricingMath.ts';

export { calculateMvpPriceUsd, mvpPricingMatrix } from './mvpPricingMath.ts';

export function createMvpValuation(input: {
  submissionId: string;
  sellerWallet: string;
  attributes: Record<string, unknown> & { caratWeight: number };
  saleMode: string;
  /** The chain the valuation is written to; production chains are refused. */
  chainId: number;
}): {
  method: string;
  approvedValuationUsd: bigint;
  valuationHash: Hash;
  valuationMatrixHash: Hash;
  canonicalPayload: string;
  nonce: `0x${string}`;
} {
  const pricingMatrix = mvpPricingMatrix(input.chainId);
  const approvedValuationUsd = calculateMvpPriceUsd(input.attributes.caratWeight);
  const timestamp = new Date().toISOString();
  const commitment = createCommitment({
    schemaVersion: 'digital-carat-valuation/v1',
    method: pricingMatrix.method,
    submissionId: input.submissionId,
    sellerWallet: input.sellerWallet,
    approvedAttributes: input.attributes,
    saleMode: input.saleMode,
    approvedValuationUsd: approvedValuationUsd.toString(),
    pricingMatrix,
    timestamp,
  });
  return {
    method: pricingMatrix.method,
    approvedValuationUsd,
    valuationHash: commitment.hash,
    valuationMatrixHash: keccak256(toBytes(canonicalize(pricingMatrix))),
    canonicalPayload: commitment.canonicalPayload,
    nonce: commitment.nonce,
  };
}

import { canonicalize } from 'npm:json-canonicalize@1.1.0';
import { keccak256, toBytes, type Hash } from 'npm:viem@2';
import { createCommitment } from './commitment.ts';
import { calculateMvpPriceUsd } from './mvpPricingMath.ts';

export const MVP_PRICING_MATRIX = {
  schemaVersion: 'digital-carat-pricing-matrix/v1',
  method: 'mvp-flat-carat-v1',
  unitPriceUsd: '500',
  minimumUsd: '100',
  maximumUsd: '25000',
  rounding: 'ceil-whole-usd',
  network: 'ethereum-sepolia',
} as const;

export { calculateMvpPriceUsd } from './mvpPricingMath.ts';

export function createMvpValuation(input: {
  submissionId: string;
  sellerWallet: string;
  attributes: Record<string, unknown> & { caratWeight: number };
  saleMode: string;
}): {
  method: string;
  approvedValuationUsd: bigint;
  valuationHash: Hash;
  valuationMatrixHash: Hash;
  canonicalPayload: string;
  nonce: `0x${string}`;
} {
  const approvedValuationUsd = calculateMvpPriceUsd(input.attributes.caratWeight);
  const timestamp = new Date().toISOString();
  const commitment = createCommitment({
    schemaVersion: 'digital-carat-valuation/v1',
    method: MVP_PRICING_MATRIX.method,
    submissionId: input.submissionId,
    sellerWallet: input.sellerWallet,
    approvedAttributes: input.attributes,
    saleMode: input.saleMode,
    approvedValuationUsd: approvedValuationUsd.toString(),
    pricingMatrix: MVP_PRICING_MATRIX,
    timestamp,
  });
  return {
    method: MVP_PRICING_MATRIX.method,
    approvedValuationUsd,
    valuationHash: commitment.hash,
    valuationMatrixHash: keccak256(toBytes(canonicalize(MVP_PRICING_MATRIX))),
    canonicalPayload: commitment.canonicalPayload,
    nonce: commitment.nonce,
  };
}

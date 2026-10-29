import { networkProfile } from './network.ts';

const USD_DECIMALS = 10n ** 18n;
const MICRO_CARAT = 1_000_000n;
const MINIMUM_USD = 100n;
const MAXIMUM_USD = 25_000n;
const UNIT_PRICE_USD = 500n;

function ceilDiv(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

export function calculateMvpPriceUsd(caratWeight: number): bigint {
  if (!Number.isFinite(caratWeight) || caratWeight <= 0 || caratWeight > 100_000) {
    throw new Error('Carat weight must be between 0 and 100,000');
  }
  const microCarats = BigInt(Math.ceil(caratWeight * Number(MICRO_CARAT)));
  let wholeUsd = ceilDiv(microCarats * UNIT_PRICE_USD, MICRO_CARAT);
  if (wholeUsd < MINIMUM_USD) wholeUsd = MINIMUM_USD;
  if (wholeUsd > MAXIMUM_USD) wholeUsd = MAXIMUM_USD;
  return wholeUsd * USD_DECIMALS;
}

/**
 * The flat-rate rule's matrix document, committed by `valuationMatrixHash`.
 *
 * `network` used to be the literal `'ethereum-sepolia'` whatever chain the
 * valuation was written to. It now comes from the configured chain. Sepolia's
 * slug is unchanged, so the Sepolia document, and its hash, are byte-identical
 * to what was committed before.
 *
 * Production chains are refused outright: this is a test-only $500/ct figure,
 * and `approvedValuationUsd` has no setter.
 */
export function mvpPricingMatrix(chainId: number) {
  const network = networkProfile(chainId);
  if (network.production) {
    throw new Error(
      `The automated test-only valuation cannot be used on ${network.slug}; a lab appraisal is required`,
    );
  }
  return {
    schemaVersion: 'digital-carat-pricing-matrix/v1',
    method: 'mvp-flat-carat-v1',
    unitPriceUsd: '500',
    minimumUsd: '100',
    maximumUsd: '25000',
    rounding: 'ceil-whole-usd',
    network: network.slug,
  } as const;
}

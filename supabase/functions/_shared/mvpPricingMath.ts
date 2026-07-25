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

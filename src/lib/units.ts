export const USD_DECIMALS = 18;

export function ceilMulDiv(value: bigint, multiplier: bigint, divisor: bigint): bigint {
  if (divisor === 0n) throw new Error('Division by zero');
  if (value === 0n || multiplier === 0n) return 0n;
  return (value * multiplier + divisor - 1n) / divisor;
}

export function usdInputToBaseUnits(value: string): bigint {
  if (!/^\d+(?:\.\d{0,18})?$/.test(value)) throw new Error('Invalid USD amount');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0') || '0');
}

export function reserveFundingPercent(balanceUsd: bigint, requiredUsd: bigint): number {
  if (requiredUsd === 0n) return 100;
  return Math.min(100, Number((balanceUsd * 10_000n) / requiredUsd) / 100);
}

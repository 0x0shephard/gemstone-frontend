/**
 * ERC-20 allowance writes needed before spending `required`.
 *
 * USDT-style tokens require a zero allowance before a new non-zero allowance,
 * while standard tokens also accept this conservative sequence.
 */
export function paymentApprovalAmounts(current: bigint, required: bigint): bigint[] {
  if (current >= required) return [];
  return [...(current > 0n ? [0n] : []), required];
}

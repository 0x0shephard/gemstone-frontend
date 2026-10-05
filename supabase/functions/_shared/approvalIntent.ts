/**
 * The recovery deadline belongs to the immutable approval intent. Preparing and
 * confirming happen in separate requests, so confirmation must reuse the value
 * stored by prepare rather than deriving a second wall-clock timestamp.
 */
export function stableRecoveryEligibleAt(
  existingPayload: unknown,
  graceSeconds: number,
  nowMs = Date.now(),
): string {
  if (existingPayload && typeof existingPayload === 'object') {
    const value = (existingPayload as Record<string, unknown>).recoveryEligibleAt;
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  }
  return new Date(nowMs + graceSeconds * 1_000).toISOString();
}

/**
 * Provider idempotency key for a redemption owner-code email.
 *
 * The first delivery of a code generation (and any retry of the step that
 * released it) shares one key, so it is sent once. A holder-requested resend
 * of the same unexpired code gets a key of its own, derived from the resend
 * request's idempotency key: a new resend click sends again, while a retried
 * HTTP call for the same click still sends once. Reusing the generation key
 * for a resend made the provider accept the call and deliver nothing.
 */
export function ownerCodeEmailKey(
  deploymentId: string,
  generationId: string,
  resendKey?: string,
): string {
  const base = `redemption-owner-code/${deploymentId}/${generationId}`;
  return resendKey ? `${base}/resend/${resendKey}` : base;
}

/**
 * How long a pending claim or cancel may sit with no recorded nonce and no
 * transaction hash before it is treated as abandoned.
 *
 * The status flips to `claim_pending`/`cancel_pending` before the operator
 * lease is taken and before `onSubmitting` records the nonce; nothing is
 * broadcast until that record succeeds. A worker that died in between left the
 * card pending forever. This is longer than the operator lease (3 minutes) and
 * any Edge worker's lifetime, so a live attempt is never reset under itself;
 * and each attempt's `onSubmitting` is conditioned on its own
 * `operation_started_at`, so even a straggler cannot broadcast after a reset.
 */
export const UNSUBMITTED_OPERATION_RESET_MS = 5 * 60_000;

/** Age of a pending operation; one with no start time is treated as abandoned. */
export function pendingOperationAgeMs(startedAt: string | null, now = Date.now()): number {
  if (!startedAt) return Number.POSITIVE_INFINITY;
  const started = Date.parse(startedAt);
  return Number.isFinite(started) ? now - started : Number.POSITIVE_INFINITY;
}

/**
 * Decision table for a gift transfer whose submission may have outlived the
 * HTTP request that started it. Only an observed destination owner completes
 * it; only an observed reverted receipt makes a retry safe; only the absence
 * of both a nonce and a hash, past the reset window, makes a reset safe.
 */
export function reconcileGiftTransfer(input: {
  currentOwner: string;
  destinationOwner: string;
  transactionHash: string | null;
  receiptStatus: 'success' | 'reverted' | null;
  receiptMatchesTransfer?: boolean;
  operationNonce?: number | null;
  senderPendingNonce?: number | null;
  senderLatestNonce?: number | null;
  operationAgeMs?: number;
}):
  | 'complete'
  | 'failed'
  | 'pending'
  | 'retry_same_nonce'
  | 'retry_fresh_nonce'
  | 'reset_unsubmitted' {
  if (input.currentOwner.toLowerCase() === input.destinationOwner.toLowerCase()) {
    return 'complete';
  }
  if (input.transactionHash && input.receiptStatus === 'success' && input.receiptMatchesTransfer) {
    return 'complete';
  }
  if (input.transactionHash && input.receiptStatus === 'reverted') return 'failed';
  if (
    !input.transactionHash &&
    (input.operationNonce === null || input.operationNonce === undefined) &&
    (input.operationAgeMs ?? 0) >= UNSUBMITTED_OPERATION_RESET_MS
  ) {
    // No nonce was ever recorded, so `onSubmitting` never completed and no
    // transaction was signed or sent for this operation.
    return 'reset_unsubmitted';
  }
  if (
    !input.transactionHash &&
    input.operationNonce !== null &&
    input.operationNonce !== undefined &&
    input.senderLatestNonce !== null &&
    input.senderLatestNonce !== undefined &&
    input.senderLatestNonce > input.operationNonce
  ) {
    return 'retry_fresh_nonce';
  }
  if (
    !input.transactionHash &&
    input.operationNonce !== null &&
    input.operationNonce !== undefined &&
    input.senderPendingNonce !== null &&
    input.senderPendingNonce !== undefined &&
    input.senderPendingNonce <= input.operationNonce &&
    (input.operationAgeMs ?? 0) >= 30_000
  ) {
    return 'retry_same_nonce';
  }
  return 'pending';
}

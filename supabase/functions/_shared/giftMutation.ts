/**
 * Decision table for a gift transfer whose submission may have outlived the
 * HTTP request that started it. Only an observed destination owner completes
 * it; only an observed reverted receipt makes a retry safe.
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
}): 'complete' | 'failed' | 'pending' | 'retry_same_nonce' | 'retry_fresh_nonce' {
  if (input.currentOwner.toLowerCase() === input.destinationOwner.toLowerCase()) {
    return 'complete';
  }
  if (input.transactionHash && input.receiptStatus === 'success' && input.receiptMatchesTransfer) {
    return 'complete';
  }
  if (input.transactionHash && input.receiptStatus === 'reverted') return 'failed';
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

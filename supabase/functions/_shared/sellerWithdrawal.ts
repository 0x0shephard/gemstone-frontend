/**
 * When a seller may withdraw their own submission.
 *
 * Only before anything reaches the chain: once activation has registered the
 * gem (or sent the registration transaction), withdrawing it is an on-chain
 * listing withdrawal that only Digital Carat can perform. A failed activation
 * that never sent its registration is still safe to withdraw.
 */
export interface WithdrawableSubmission {
  status: string;
  activation_state?: string | null;
  onchain_gem_id?: string | number | null;
  registration_tx_hash?: string | null;
}

const CLOSED_STATUSES = new Set(['withdrawn', 'rejected', 'registered']);
const PRE_CHAIN_ACTIVATION = new Set(['pending', 'prepared', 'failed']);

export function sellerWithdrawalBlocker(submission: WithdrawableSubmission): string | null {
  if (CLOSED_STATUSES.has(submission.status)) return 'This submission is already closed';
  if (submission.onchain_gem_id || submission.registration_tx_hash) {
    return 'This stone is already registered on-chain; contact Digital Carat to withdraw it';
  }
  if (!PRE_CHAIN_ACTIVATION.has(submission.activation_state ?? 'pending')) {
    return 'Activation is in progress; try again once it finishes';
  }
  return null;
}

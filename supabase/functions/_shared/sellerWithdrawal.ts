/**
 * When a seller may withdraw their own submission.
 *
 * Only before anything reaches the chain: once activation has registered the
 * gem, sent the registration transaction, or recorded the block it was about to
 * send it from, withdrawing it is an on-chain listing withdrawal that only
 * Digital Carat can perform. The scan floor counts because it is written
 * immediately before the broadcast; a registration may be in flight even though
 * no hash has been recorded yet. A failed activation that never got that far is
 * still safe to withdraw.
 */
import { registrationMayHaveBeenSent } from './sellerOnboarding.ts';

export interface WithdrawableSubmission {
  status: string;
  activation_state?: string | null;
  onchain_gem_id?: string | number | null;
  registration_tx_hash?: string | null;
  registration_scan_from_block?: string | number | null;
}

const CLOSED_STATUSES = new Set(['withdrawn', 'rejected', 'registered']);
const PRE_CHAIN_ACTIVATION = new Set(['pending', 'prepared', 'failed']);

export function sellerWithdrawalBlocker(submission: WithdrawableSubmission): string | null {
  if (CLOSED_STATUSES.has(submission.status)) return 'This submission is already closed';
  if (registrationMayHaveBeenSent(submission)) {
    return 'This stone is already registered on-chain; contact Digital Carat to withdraw it';
  }
  if (!PRE_CHAIN_ACTIVATION.has(submission.activation_state ?? 'pending')) {
    return 'Activation is in progress; try again once it finishes';
  }
  return null;
}

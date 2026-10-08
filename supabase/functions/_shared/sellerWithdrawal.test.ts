import { describe, expect, it } from 'vitest';
import { sellerWithdrawalBlocker } from './sellerWithdrawal';

describe('seller withdrawal', () => {
  it('allows withdrawal while nothing has reached the chain', () => {
    for (const status of [
      'submitted',
      'awaiting_custody',
      'awaiting_grading',
      'graded',
      'approved',
    ]) {
      expect(sellerWithdrawalBlocker({ status, activation_state: 'pending' })).toBeNull();
    }
    expect(
      sellerWithdrawalBlocker({ status: 'approved', activation_state: 'prepared' }),
    ).toBeNull();
    // A failed activation that never sent its registration is still off-chain.
    expect(sellerWithdrawalBlocker({ status: 'approved', activation_state: 'failed' })).toBeNull();
  });

  it('refuses once the gem is registered or registration was sent', () => {
    expect(
      sellerWithdrawalBlocker({
        status: 'approved',
        activation_state: 'failed',
        onchain_gem_id: 7,
      }),
    ).toMatch(/registered on-chain/);
    expect(
      sellerWithdrawalBlocker({
        status: 'approved',
        activation_state: 'failed',
        registration_tx_hash: '0xabc',
      }),
    ).toMatch(/registered on-chain/);
  });

  it('refuses while activation is running and for closed submissions', () => {
    expect(
      sellerWithdrawalBlocker({ status: 'approved', activation_state: 'registering' }),
    ).toMatch(/in progress/);
    for (const status of ['withdrawn', 'rejected', 'registered']) {
      expect(sellerWithdrawalBlocker({ status })).toMatch(/already closed/);
    }
  });
});

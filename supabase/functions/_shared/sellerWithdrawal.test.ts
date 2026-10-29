import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('refuses once the registration broadcast may have begun, before any hash exists', () => {
    // The scan floor is written immediately before `registerGem` is sent, so a
    // registration can be in flight while the row still has no hash.
    expect(
      sellerWithdrawalBlocker({
        status: 'approved',
        activation_state: 'failed',
        registration_scan_from_block: 519_400_123,
      }),
    ).toMatch(/registered on-chain/);
    expect(
      sellerWithdrawalBlocker({
        status: 'approved',
        activation_state: 'failed',
        registration_scan_from_block: 0,
      }),
    ).toMatch(/registered on-chain/);
  });

  it('is enforced again in the conditional update, not only in the precheck', () => {
    const endpoint = readFileSync(
      join(process.cwd(), 'supabase/functions/v1-seller-submit/index.ts'),
      'utf8',
    );
    const withdraw = endpoint.slice(endpoint.indexOf("body.action === 'withdraw'"));
    expect(withdraw).toContain('registration_scan_from_block');
    expect(withdraw).toContain(".is('registration_tx_hash', null)");
    expect(withdraw).toContain(".is('registration_scan_from_block', null)");
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

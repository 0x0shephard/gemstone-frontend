import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('gift submission ambiguity safety', () => {
  it('persists the operator nonce before starting the RPC write', () => {
    const chain = source('supabase/functions/_shared/chain.ts');
    const intent = chain.indexOf('await lifecycle.onSubmitting?.(nonce)');
    const write = chain.indexOf('chain.walletClient.writeContract(request)');

    expect(intent).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(intent);
  });

  it.each([
    ['claim', 'supabase/functions/v1-gift-claim/index.ts', "state: 'claiming'"],
    ['cancel', 'supabase/functions/v1-gift-cancel/index.ts', "status: 'cancel_pending'"],
  ])('keeps %s pending after an accepted broadcast loses its RPC response', (_, path, state) => {
    const endpoint = source(path);
    const accepted = endpoint.indexOf('if (submissionAttempted)');
    const preBroadcast = endpoint.indexOf('if (!initialAttempt)', accepted);
    const acceptedBranch = endpoint.slice(accepted, preBroadcast);

    expect(accepted).toBeGreaterThan(-1);
    expect(acceptedBranch).toContain(state);
    expect(acceptedBranch).toContain('202');
    expect(acceptedBranch).not.toContain("status: 'active'");
    expect(acceptedBranch).not.toContain('cancel_from_status: null');
  });

  it.each([
    ['claim', 'supabase/functions/v1-gift-claim/index.ts'],
    ['cancel', 'supabase/functions/v1-gift-cancel/index.ts'],
  ])('requires a durable %s intent row before treating submission as started', (_, path) => {
    const endpoint = source(path);
    const callback = endpoint.slice(
      endpoint.indexOf('onSubmitting: async'),
      endpoint.indexOf('onSubmitted: async'),
    );

    expect(callback).toContain(".select('id')");
    expect(callback).toContain('if (!lockedIntent) throw');
    expect(callback.indexOf('submissionAttempted = true')).toBeGreaterThan(
      callback.indexOf('if (!lockedIntent) throw'),
    );
  });

  it('serializes different gifts through one operator-wide lease', () => {
    const lease = source('supabase/functions/_shared/giftTransferLease.ts');
    const claim = source('supabase/functions/v1-gift-claim/index.ts');
    const cancel = source('supabase/functions/v1-gift-cancel/index.ts');

    expect(lease).toContain("const OPERATOR_LEASE = 'sepolia-seller-activation'");
    expect(lease).toContain(".eq('lease_name', OPERATOR_LEASE)");
    expect(lease).toContain('expires_at.lt.');
    expect(claim).toContain('const leaseHolder = crypto.randomUUID()');
    expect(cancel).toContain('const leaseHolder = crypto.randomUUID()');
    expect(claim.indexOf('leaseClaimed = await claimGiftTransferLease')).toBeLessThan(
      claim.indexOf('writeAndConfirm('),
    );
    expect(cancel.indexOf('leaseClaimed = await claimGiftTransferLease')).toBeLessThan(
      cancel.indexOf('writeAndConfirm('),
    );
  });
});

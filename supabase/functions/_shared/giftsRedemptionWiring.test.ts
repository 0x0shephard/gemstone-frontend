import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Endpoint wiring for the 2026-10-29 Arbitrum audit fixes. The decisions are
 * unit-tested in their shared modules; these pin that the endpoints use them.
 */
const source = (path: string) =>
  readFileSync(join(process.cwd(), 'supabase/functions', path), 'utf8');
const lifecycle = source('v1-redemption-lifecycle/index.ts');
const sweep = source('v1-notify-sweep/index.ts');
const claim = source('v1-gift-claim/index.ts');
const cancel = source('v1-gift-cancel/index.ts');

const between = (text: string, from: string, to: string) => {
  const start = text.indexOf(from);
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf(to, start + from.length);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
};

describe('recovery from a Safe', () => {
  it('validates every recovery step by manager events, not by sender and target', () => {
    const recovery = between(
      lifecycle,
      "if (['propose_recovery', 'approve_recovery', 'execute_recovery'].includes(action))",
      "if (action === 'prepare_owner_authorization'",
    );
    expect(recovery.match(/confirmedRecoveryStep\(/g)).toHaveLength(3);
    expect(recovery).not.toContain('receiptEvents(deployment, transactionHash, recoveryWallet)');
    // executeRecovery's event names no proposal, so the manager's record is read.
    expect(recovery).toContain('executedProposal.executed');
  });
});

describe('sweep cancel/confirm', () => {
  it('updates only the rows the event closed', () => {
    const handler = between(
      sweep,
      "event.eventName === 'RedemptionConfirmed' ||",
      'Neither event carries the owner',
    );
    expect(handler).toContain('redemptionRowsClosedBy(');
    expect(handler).toContain(".in('id', closedIds)");
  });

  it('no longer alerts the operator wallet recorded as gem custodian', () => {
    const opened = between(
      sweep,
      "if (event.eventName === 'RedemptionOpened')",
      "event.eventName === 'RedemptionConfirmed' ||",
    );
    expect(opened).not.toContain('gem.custodian');
    expect(opened).toContain('alertRedemptionOpened(');
    expect(sweep).not.toMatch(/confirm the handover/i);
  });
});

describe('proxy nomination and finalize authorization', () => {
  it('advertises nomination only while the server accepts a new one', () => {
    const actions = between(lifecycle, 'function currentActions(', 'function eventView(');
    expect(actions).toContain(
      "if (owner && row.status === 'onchain_requested') {\n    actions.push('prepare_proxy_nomination', 'nominate_proxy');",
    );
    expect(actions).not.toMatch(
      /OWNER_CANCELLABLE_STATES\.includes\(status\)\)\s*\{\s*actions\.push\('prepare_proxy_nomination'/,
    );
  });

  it('signs the on-chain collector commitment and reconciles the row to it', () => {
    const authorize = between(
      lifecycle,
      "if (action === 'prepare_owner_authorization' || action === 'authorize_owner')",
      "if (action === 'mark_chain_burned')",
    );
    expect(authorize).toContain('finalizeAuthorizationBinding(');
    expect(authorize).toContain('const collectorCommitment = binding.collectorCommitment');
    expect(authorize).not.toContain('row.collector_commitment ?? zeroHash');
    expect(authorize).toContain('collectorCommitmentChanged ? { collectorCommitment }');
  });
});

describe('smart-wallet owners', () => {
  it('verifies owner signatures with the public client (ERC-1271 / ERC-6492)', () => {
    expect(lifecycle).not.toMatch(/^\s*verifyMessage,\s*$/m);
    expect(lifecycle).toContain('redemptionReadClient().verifyMessage(');
    expect(lifecycle.match(/verifiedWalletSignature\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('checks owner receipts by events rather than requiring a direct EOA call', () => {
    expect(lifecycle).not.toContain('getAddress(row.requester_wallet),\n      );');
    expect(lifecycle.match(/ownerReceiptEvents\(deployment, transactionHash\)/g)).toHaveLength(4);
  });
});

describe('owner-code resend', () => {
  it('passes the resend request key so the provider sends again', () => {
    expect(lifecycle).toContain('deliverOwnerCode(admin, deployment.id, row, idempotencyKey)');
    expect(lifecycle).toContain('ownerCodeEmailKey(');
  });
});

describe('gift claim and cancel', () => {
  it('reconciles a pending claim against the stored claimed wallet', () => {
    expect(claim).toContain("card.status === 'claim_pending' && card.claimed_wallet");
    expect(claim).toContain('reconcilePendingClaim(recipientWallet)');
    const reconcile = between(
      claim,
      'async function reconcilePendingClaim(',
      "if (card.status === 'claim_pending') {",
    );
    expect(reconcile).toContain('destinationOwner: destination');
    expect(reconcile).toContain('getAddress(event.args.to) === destination');
  });

  it.each([
    ['claim', claim, 'claim_tx_hash'],
    ['cancel', cancel, 'return_tx_hash'],
  ])(
    'resets an abandoned unsubmitted %s only when it is still that attempt',
    (_name, file, hash) => {
      const reset = between(file, "reconciliation === 'reset_unsubmitted'", '.maybeSingle()');
      expect(reset).toContain(".is('operation_nonce', null)");
      expect(reset).toContain(`.is('${hash}', null)`);
      expect(reset).toContain("eq('operation_started_at', card.operation_started_at)");
    },
  );

  it.each([
    ['claim', claim],
    ['cancel', cancel],
  ])('binds the %s nonce record to its own attempt', (_name, file) => {
    const callback = between(file, 'onSubmitting: async', 'onSubmitted: async');
    expect(callback).toContain(".eq('operation_started_at', attemptStartedAt)");
  });

  it('lets the sender cancel a claim abandoned before broadcast', () => {
    expect(cancel).toContain("'claim_pending', 'cancel_pending']");
    expect(cancel).toContain('UNSUBMITTED_OPERATION_RESET_MS');
  });
});

describe('Sepolia fallbacks', () => {
  it.each([
    'v1-redemption-lifecycle/index.ts',
    'v1-notify-sweep/index.ts',
    'v1-gift-claim/index.ts',
    'v1-gift-cancel/index.ts',
    'v1-gift-create/index.ts',
    'v1-redemption-fulfillment/index.ts',
  ])('%s refuses SEPOLIA_* before building the operator chain', (path) => {
    const file = source(path);
    if (!file.includes('operatorChain()')) return;
    expect(file).toContain('assertNoLegacySepoliaFallback();');
    expect(file.indexOf('assertNoLegacySepoliaFallback();')).toBeLessThan(
      file.indexOf('operatorChain()'),
    );
  });

  it.each(['_shared/redemptionChain.ts', 'v1-redemption-lifecycle/index.ts'])(
    '%s reads no SEPOLIA_* secret directly',
    (path) => {
      expect(source(path)).not.toMatch(/env\.get\('SEPOLIA_/);
    },
  );
});

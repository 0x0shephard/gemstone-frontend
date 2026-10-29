import { keccak256, toBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  SAFE_EXECUTION_SUCCESS_TOPIC,
  actorExecutedTransaction,
  missingTransactionMessage,
  verifyRecoveryReceipt,
  type ParsedManagerLog,
  type RawReceiptLog,
} from './receiptValidation';

// The production roles: the Safe and the EOA recovery approvers, and an owner
// of the Safe who pays gas when it executes.
const manager = '0x00000000000000000000000000000000000000aa';
const safe = '0xD420d1bdCFd89eC47437E6Ca97Bf32373a5C94A9';
const eoaApprover = '0xb72DC001f39f9a4A8E1cA1cd4271060860E56742';
const safeOwner = '0x1111111111111111111111111111111111111111';
const attacker = '0x2222222222222222222222222222222222222222';
const proposalHash = `0x${'ab'.repeat(32)}`;
const evidenceDigest = `0x${'cd'.repeat(32)}`;
const owner = '0x3333333333333333333333333333333333333333';

const approved = (approver: string, approvals = 2, address = manager): ParsedManagerLog => ({
  address,
  eventName: 'RecoveryApproved',
  args: { tokenId: 7n, proposalHash, approver, approvals },
});
const safeExecuted = (address = safe): RawReceiptLog => ({
  address,
  topics: [SAFE_EXECUTION_SUCCESS_TOPIC],
});

const base = {
  chainId: 42161,
  expectedChainId: 42161,
  status: 'success',
  manager,
};

describe('recovery receipt validation', () => {
  it('pins the Safe ExecutionSuccess topic', () => {
    expect(SAFE_EXECUTION_SUCCESS_TOPIC).toBe(
      keccak256(toBytes('ExecutionSuccess(bytes32,uint256)')),
    );
  });

  it('accepts an approval sent directly by the EOA approver', () => {
    expect(
      verifyRecoveryReceipt({
        ...base,
        from: eoaApprover,
        approver: eoaApprover,
        rawLogs: [],
        managerLogs: [approved(eoaApprover)],
        step: { kind: 'approve', tokenId: '7', proposalHash },
      }),
    ).toEqual({ proposalHash, approvals: 2 });
  });

  it('accepts an approval executed by the Safe, sent by one of its owners', () => {
    // A Safe transaction: to = the Safe, from = the executing owner. The manager
    // recorded the Safe as msg.sender, which is what binds the approver.
    expect(
      verifyRecoveryReceipt({
        ...base,
        from: safeOwner,
        approver: safe,
        rawLogs: [safeExecuted()],
        managerLogs: [approved(safe.toLowerCase())],
        step: { kind: 'approve', tokenId: '7', proposalHash },
      }),
    ).toEqual({ proposalHash, approvals: 2 });
  });

  it('accepts a proposal executed by the Safe and returns the emitted proposal hash', () => {
    expect(
      verifyRecoveryReceipt({
        ...base,
        from: safeOwner,
        approver: safe,
        rawLogs: [safeExecuted()],
        managerLogs: [
          {
            address: manager,
            eventName: 'RecoveryProposed',
            args: { tokenId: 7n, proposalHash, evidenceDigest, proposer: safe },
          },
          approved(safe, 1),
        ],
        step: { kind: 'propose', tokenId: '7', evidenceDigest },
      }),
    ).toEqual({ proposalHash, approvals: 1 });
  });

  it('rejects a forged receipt whose events come from another contract', () => {
    expect(() =>
      verifyRecoveryReceipt({
        ...base,
        from: safeOwner,
        approver: safe,
        rawLogs: [safeExecuted()],
        // Same signature and arguments, emitted by an attacker's contract.
        managerLogs: [approved(safe, 2, attacker)],
        step: { kind: 'approve', tokenId: '7', proposalHash },
      }),
    ).toThrow('did not approve this recovery');
  });

  it('rejects a receipt where someone else approved', () => {
    expect(() =>
      verifyRecoveryReceipt({
        ...base,
        from: attacker,
        approver: safe,
        rawLogs: [],
        managerLogs: [approved(attacker)],
        step: { kind: 'approve', tokenId: '7', proposalHash },
      }),
    ).toThrow('did not approve this recovery');
  });

  it.each([
    ['another token', { tokenId: '8', proposalHash }],
    ['another proposal', { tokenId: '7', proposalHash: `0x${'ef'.repeat(32)}` }],
  ])('rejects an approval for %s', (_name, step) => {
    expect(() =>
      verifyRecoveryReceipt({
        ...base,
        from: eoaApprover,
        approver: eoaApprover,
        rawLogs: [],
        managerLogs: [approved(eoaApprover)],
        step: { kind: 'approve', ...step },
      }),
    ).toThrow('did not approve this recovery');
  });

  it('rejects a reverted or wrong-chain receipt', () => {
    const input = {
      ...base,
      from: eoaApprover,
      approver: eoaApprover,
      rawLogs: [],
      managerLogs: [approved(eoaApprover)],
      step: { kind: 'approve' as const, tokenId: '7', proposalHash },
    };
    expect(() => verifyRecoveryReceipt({ ...input, status: 'reverted' })).toThrow(
      'did not successfully call',
    );
    expect(() => verifyRecoveryReceipt({ ...input, chainId: 1 })).toThrow('wrong chain');
  });

  describe('execution, which emits no actor', () => {
    const finalized: ParsedManagerLog = {
      address: manager,
      eventName: 'RedemptionFinalized',
      args: { tokenId: 7n, gemId: 3n, owner, recovered: true },
    };
    const step = { kind: 'execute' as const, tokenId: '7', gemId: '3', owner, proposalHash };

    it('accepts the EOA approver sending it', () => {
      expect(
        verifyRecoveryReceipt({
          ...base,
          from: eoaApprover,
          approver: eoaApprover,
          rawLogs: [],
          managerLogs: [finalized],
          step,
        }),
      ).toEqual({ proposalHash, approvals: null });
    });

    it('accepts the Safe executing it', () => {
      expect(
        verifyRecoveryReceipt({
          ...base,
          from: safeOwner,
          approver: safe,
          rawLogs: [safeExecuted()],
          managerLogs: [finalized],
          step,
        }),
      ).toEqual({ proposalHash, approvals: null });
    });

    it('rejects an execution the acting wallet neither sent nor executed', () => {
      expect(() =>
        verifyRecoveryReceipt({
          ...base,
          from: attacker,
          approver: safe,
          // ExecutionSuccess from a different Safe does not count.
          rawLogs: [safeExecuted(attacker)],
          managerLogs: [finalized],
          step,
        }),
      ).toThrow('not sent or executed by the acting recovery wallet');
    });

    it('rejects a finalization that was not a recovery', () => {
      expect(() =>
        verifyRecoveryReceipt({
          ...base,
          from: eoaApprover,
          approver: eoaApprover,
          rawLogs: [],
          managerLogs: [
            { ...finalized, args: { ...(finalized.args as object), recovered: false } },
          ],
          step,
        }),
      ).toThrow('not finalized as recovery');
    });
  });

  it('detects a Safe execution only from the Safe itself', () => {
    expect(actorExecutedTransaction({ from: safeOwner, logs: [safeExecuted()], actor: safe })).toBe(
      true,
    );
    expect(
      actorExecutedTransaction({
        from: safeOwner,
        logs: [{ address: safe, topics: [`0x${'00'.repeat(32)}`] }],
        actor: safe,
      }),
    ).toBe(false);
  });

  it('explains a safeTxHash that is not an on-chain transaction', () => {
    expect(missingTransactionMessage(false)).toContain('safeTxHash');
    expect(missingTransactionMessage(false)).toContain('executed on-chain transaction');
    expect(missingTransactionMessage(true)).toContain('not been mined');
  });
});

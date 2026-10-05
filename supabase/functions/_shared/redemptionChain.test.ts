import { describe, expect, it } from 'vitest';
import {
  assertReceiptEnvelope,
  assertRedemptionEventArgs,
  redemptionManagerLogs,
} from './receiptValidation';

const manager = '0x0000000000000000000000000000000000000001';
const sender = '0x0000000000000000000000000000000000000002';

describe('redemption receipt reconciliation', () => {
  it('accepts only a successful exact-chain manager call from the expected sender', () => {
    expect(() =>
      assertReceiptEnvelope({
        chainId: 11155111,
        expectedChainId: 11155111,
        status: 'success',
        to: manager,
        manager,
        from: sender,
        expectedSender: sender,
      }),
    ).not.toThrow();
  });

  it.each([
    ['wrong chain', { chainId: 1 }, 'wrong chain'],
    ['reverted', { status: 'reverted' }, 'did not successfully call'],
    ['wrong manager', { to: sender }, 'did not successfully call'],
    ['wrong sender', { from: manager }, 'sender does not match'],
  ])('rejects %s receipts', (_name, override, message) => {
    expect(() =>
      assertReceiptEnvelope({
        chainId: 11155111,
        expectedChainId: 11155111,
        status: 'success',
        to: manager,
        manager,
        from: sender,
        expectedSender: sender,
        ...override,
      }),
    ).toThrow(message);
  });

  it('ignores same-signature logs emitted by a foreign address', () => {
    const authentic = { address: manager, data: 'authentic' };
    const spoof = { address: sender, data: 'spoof' };
    expect(redemptionManagerLogs([spoof, authentic], manager)).toEqual([authentic]);
  });

  it('binds request/workflow, proof/version/approval, and recovered finalization args', () => {
    expect(() =>
      assertRedemptionEventArgs(
        {
          tokenId: 7n,
          requestHash: '0xrequest',
          workflowIdHash: '0xworkflow',
          proofDigest: '0xproof',
          proofVersion: 2n,
          approvalId: '0xapproval',
          recovered: true,
        },
        {
          tokenId: '7',
          requestHash: '0xrequest',
          workflowIdHash: '0xworkflow',
          proofDigest: '0xproof',
          proofVersion: '2',
          approvalId: '0xapproval',
          recovered: true,
        },
      ),
    ).not.toThrow();
    for (const [key, value] of [
      ['tokenId', '8'],
      ['requestHash', '0xwrong'],
      ['workflowIdHash', '0xwrong'],
      ['proofDigest', '0xwrong'],
      ['proofVersion', '3'],
      ['approvalId', '0xwrong'],
      ['recovered', false],
    ] as const) {
      expect(() =>
        assertRedemptionEventArgs(
          {
            tokenId: 7n,
            requestHash: '0xrequest',
            workflowIdHash: '0xworkflow',
            proofDigest: '0xproof',
            proofVersion: 2n,
            approvalId: '0xapproval',
            recovered: true,
          },
          { [key]: value },
        ),
      ).toThrow('does not match this workflow');
    }
  });
});

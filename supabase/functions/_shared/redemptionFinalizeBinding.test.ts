import { describe, expect, it } from 'vitest';
import { ZERO_HASH, finalizeAuthorizationBinding } from './redemptionFinalizeBinding';

const commitment = `0x${'c0'.repeat(32)}`;
const row = {
  requester_wallet: '0x1111111111111111111111111111111111111111',
  request_hash: `0x${'01'.repeat(32)}`,
  proof_digest: `0x${'02'.repeat(32)}`,
  proof_version: '1',
  proof_approval_id: `0x${'03'.repeat(32)}`,
  proof_approval_version: 6,
  collector_commitment: null,
};
const workflowIdHash = `0x${'04'.repeat(32)}`;
const record = {
  owner: '0x1111111111111111111111111111111111111111',
  requestHash: row.request_hash.toUpperCase().replace('0X', '0x'),
  workflowIdHash,
  collectorCommitment: ZERO_HASH as string,
  proofDigest: row.proof_digest,
  approvalId: row.proof_approval_id,
  approvalVersion: 6n,
  proofVersion: 1n,
  phase: 4,
};

describe('finalize authorization binding', () => {
  it('signs the on-chain collector commitment when the nomination receipt was never recorded', () => {
    // The owner's setCollectorCommitment landed, the callback did not: the row
    // still has no commitment. Signing zeroHash would never verify.
    expect(
      finalizeAuthorizationBinding({
        row,
        workflowIdHash,
        record: { ...record, collectorCommitment: commitment },
      }),
    ).toEqual({ collectorCommitment: commitment, collectorCommitmentChanged: true });
  });

  it('signs the zero commitment when no proxy was ever nominated', () => {
    expect(finalizeAuthorizationBinding({ row, workflowIdHash, record })).toEqual({
      collectorCommitment: ZERO_HASH,
      collectorCommitmentChanged: false,
    });
  });

  it('follows the chain when the owner replaced a recorded commitment', () => {
    expect(
      finalizeAuthorizationBinding({
        row: { ...row, collector_commitment: commitment },
        workflowIdHash,
        record,
      }),
    ).toEqual({ collectorCommitment: ZERO_HASH, collectorCommitmentChanged: true });
  });

  it.each([
    ['owner', { owner: '0x2222222222222222222222222222222222222222' }],
    ['workflow', { workflowIdHash: `0x${'05'.repeat(32)}` }],
    ['proof digest', { proofDigest: `0x${'06'.repeat(32)}` }],
    ['proof version', { proofVersion: 2n }],
    ['approval', { approvalId: `0x${'07'.repeat(32)}` }],
    ['approval version', { approvalVersion: 7n }],
  ])('refuses to sign when the on-chain %s differs', (label, change) => {
    expect(() =>
      finalizeAuthorizationBinding({ row, workflowIdHash, record: { ...record, ...change } }),
    ).toThrow(`on-chain redemption ${label} does not match`);
  });

  it('refuses to sign unless the chain is awaiting owner authorization', () => {
    expect(() =>
      finalizeAuthorizationBinding({ row, workflowIdHash, record: { ...record, phase: 5 } }),
    ).toThrow('not awaiting owner authorization');
  });
});

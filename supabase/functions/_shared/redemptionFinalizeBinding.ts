/**
 * What the server's finalize authorization must bind.
 *
 * `RedemptionManager.redemptionAuthorizationDigest` hashes the on-chain record,
 * not the database row. The owner can set a collector commitment on-chain
 * whose receipt never reached the server (a closed tab, or the workflow moving
 * on before the callback). Signing the row's value then produced an
 * authorization that could never verify, so finalize always reverted.
 *
 * The on-chain record is therefore the source for the collector commitment,
 * and every other field is checked against it so a signature is only issued
 * when the chain will accept it.
 */

export const ZERO_HASH = `0x${'0'.repeat(64)}` as const;

/** RedemptionManager.RedemptionPhase.ProofApproved. */
const PROOF_APPROVED_PHASE = 4;

export interface FinalizeRowBinding {
  requester_wallet: string;
  request_hash: string | null;
  proof_digest: string | null;
  proof_version: number | string | null;
  proof_approval_id: string | null;
  proof_approval_version: number | string | null;
  collector_commitment: string | null;
}

export interface FinalizeChainRecord {
  owner: string;
  requestHash: string;
  workflowIdHash: string;
  collectorCommitment: string;
  proofDigest: string;
  approvalId: string;
  approvalVersion: bigint | number | string;
  proofVersion: bigint | number | string;
  phase: number;
}

const same = (left: unknown, right: unknown) =>
  String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase();

export function finalizeAuthorizationBinding(input: {
  row: FinalizeRowBinding;
  workflowIdHash: string;
  record: FinalizeChainRecord;
}): { collectorCommitment: string; collectorCommitmentChanged: boolean } {
  const { row, record } = input;
  if (Number(record.phase) !== PROOF_APPROVED_PHASE) {
    throw new Error('The on-chain redemption is not awaiting owner authorization');
  }
  const checks: Array<[string, unknown, unknown]> = [
    ['owner', record.owner, row.requester_wallet],
    ['request hash', record.requestHash, row.request_hash],
    ['workflow', record.workflowIdHash, input.workflowIdHash],
    ['proof digest', record.proofDigest, row.proof_digest],
    ['proof version', String(record.proofVersion), String(row.proof_version)],
    ['approval', record.approvalId, row.proof_approval_id],
    ['approval version', String(record.approvalVersion), String(row.proof_approval_version)],
  ];
  for (const [label, chain, stored] of checks) {
    if (!same(chain, stored)) {
      throw new Error(`The on-chain redemption ${label} does not match this workflow`);
    }
  }
  const collectorCommitment = String(record.collectorCommitment).toLowerCase();
  return {
    collectorCommitment,
    collectorCommitmentChanged: !same(row.collector_commitment ?? ZERO_HASH, collectorCommitment),
  };
}

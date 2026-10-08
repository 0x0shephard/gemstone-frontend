import { getAddress, keccak256, parseAbi, toBytes, type Address, type Hash } from 'npm:viem@2';
import { adminClient } from './auth.ts';
import { gemRegistryAbi, operatorChain, writeAndConfirm, type OperatorChain } from './chain.ts';
import { claimGiftTransferLease, releaseGiftTransferLease } from './giftTransferLease.ts';

/**
 * Server-signed redemption steps.
 *
 * Activation registers every gem with the operator wallet as its on-chain
 * custodian, and that wallet also holds PROOF_APPROVER_ROLE. So the custodian
 * vault's staff never sign anything: when they confirm a request or record an
 * arrival in the portal, this module sends the matching RedemptionManager call.
 * A dedicated approver key (REDEMPTION_PROOF_APPROVER_PRIVATE_KEY) replaces the
 * operator for approvals once it is granted the role.
 */
export const redemptionWriteAbi = parseAbi([
  'function startFulfillment(uint256 tokenId)',
  'function submitFulfillmentProof(uint256 tokenId, bytes32 proofDigest)',
  'function approveFulfillmentProof(uint256 tokenId, bytes32 approvalId, uint64 approvalVersion)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function redemptionRecord(uint256 tokenId) view returns ((address owner,bytes32 requestHash,bytes32 workflowIdHash,bytes32 collectorCommitment,bytes32 proofDigest,bytes32 approvalId,uint64 requestedAt,uint64 fulfillmentStartedAt,uint64 proofSubmittedAt,uint64 proofApprovedAt,uint64 approvalVersion,uint64 proofVersion,uint8 phase))',
]);

/** RedemptionManager.RedemptionPhase. */
export const ChainPhase = {
  None: 0,
  Requested: 1,
  FulfillmentStarted: 2,
  ProofSubmitted: 3,
  ProofApproved: 4,
  Completed: 5,
} as const;

export interface ChainRedemptionRecord {
  owner: Address;
  workflowIdHash: Hash;
  proofDigest: Hash;
  approvalId: Hash;
  approvalVersion: bigint;
  proofVersion: bigint;
  phase: number;
}

const PROOF_APPROVER_ROLE = keccak256(toBytes('PROOF_APPROVER_ROLE'));

export async function readRedemptionRecord(
  chain: OperatorChain,
  manager: Address,
  tokenId: bigint,
): Promise<ChainRedemptionRecord> {
  const record = (await chain.publicClient.readContract({
    address: manager,
    abi: redemptionWriteAbi,
    functionName: 'redemptionRecord',
    args: [tokenId],
  })) as unknown as ChainRedemptionRecord;
  return { ...record, phase: Number(record.phase) };
}

/** Refuses before any signing when the operator is not the gem's custodian. */
export async function assertOperatorIsCustodian(
  chain: OperatorChain,
  registry: Address,
  gemId: bigint,
): Promise<void> {
  const gem = (await chain.publicClient.readContract({
    address: registry,
    abi: gemRegistryAbi,
    functionName: 'getGem',
    args: [gemId],
  })) as { custodian: Address };
  if (getAddress(gem.custodian) !== getAddress(chain.account.address)) {
    throw new Error(
      `Gem ${gemId} lists ${gem.custodian} as custodian, not the operator wallet; ` +
        'this redemption cannot be fulfilled by the server.',
    );
  }
}

/** The signer for `approveFulfillmentProof`, verified to hold the role. */
export async function proofApproverChain(
  operator: OperatorChain,
  manager: Address,
  authorizer: Address,
): Promise<OperatorChain> {
  const key = Deno.env.get('REDEMPTION_PROOF_APPROVER_PRIVATE_KEY')?.trim();
  if (key && !/^0x[0-9a-f]{64}$/i.test(key)) {
    throw new Error('REDEMPTION_PROOF_APPROVER_PRIVATE_KEY is malformed');
  }
  const chain = key ? operatorChain(key as Hash) : operator;
  if (getAddress(chain.account.address) === getAddress(authorizer)) {
    throw new Error('Proof approver and authorization signer must be distinct');
  }
  const hasRole = await chain.publicClient.readContract({
    address: manager,
    abi: redemptionWriteAbi,
    functionName: 'hasRole',
    args: [PROOF_APPROVER_ROLE, chain.account.address],
  });
  if (!hasRole) {
    throw new Error(`${chain.account.address} does not have PROOF_APPROVER_ROLE`);
  }
  return chain;
}

export class OperatorBusyError extends Error {
  constructor() {
    super('The protocol wallet is busy with another transaction. Try again in a moment.');
  }
}

/**
 * Sends one RedemptionManager write and waits for it.
 *
 * Writes from the operator share the operator-wide lease with seller
 * activation and gift transfers, because all three allocate nonces for the same
 * account. `onSubmitted` persists the hash before the receipt wait so a
 * timed-out request can be reconciled instead of re-sent.
 */
export async function sendRedemptionWrite(input: {
  admin: ReturnType<typeof adminClient>;
  chain: OperatorChain;
  operator: OperatorChain;
  manager: Address;
  functionName: 'startFulfillment' | 'submitFulfillmentProof' | 'approveFulfillmentProof';
  args: readonly unknown[];
  onSubmitted: (hash: Hash) => Promise<void>;
}): Promise<Hash> {
  const usesOperator =
    getAddress(input.chain.account.address) === getAddress(input.operator.account.address);
  const holder = crypto.randomUUID();
  if (usesOperator && !(await claimGiftTransferLease(input.admin, holder))) {
    throw new OperatorBusyError();
  }
  try {
    return await writeAndConfirm(
      input.chain,
      {
        address: input.manager,
        abi: redemptionWriteAbi,
        functionName: input.functionName,
        args: input.args,
      } as Parameters<typeof writeAndConfirm>[1],
      { onSubmitted: input.onSubmitted },
    );
  } finally {
    if (usesOperator) await releaseGiftTransferLease(input.admin, holder);
  }
}

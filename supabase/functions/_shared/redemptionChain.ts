import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hash,
  type Log,
} from 'npm:viem@2';
import { deploymentRpcUrl } from './legacySepoliaEnv.ts';
import {
  assertReceiptEnvelope,
  assertReceiptOutcome,
  assertRedemptionEventArgs,
  missingTransactionMessage,
  redemptionManagerLogs,
  verifyRecoveryReceipt,
  type RecoveryStep,
} from './receiptValidation.ts';

export { assertReceiptEnvelope, assertRedemptionEventArgs, redemptionManagerLogs };

export const redemptionLifecycleAbi = parseAbi([
  'event CollectorCommitmentSet(uint256 indexed tokenId, bytes32 indexed collectorCommitment)',
  'event RedemptionOpened(uint256 indexed tokenId, uint256 indexed gemId, address indexed owner, bytes32 requestHash)',
  'event RedemptionWorkflowBound(uint256 indexed tokenId, bytes32 indexed workflowIdHash)',
  'event RedemptionCancelled(uint256 indexed tokenId, uint256 indexed gemId)',
  'event FulfillmentStarted(uint256 indexed tokenId, uint256 indexed gemId, address indexed custodian)',
  'event FulfillmentProofSubmitted(uint256 indexed tokenId, bytes32 indexed proofDigest, uint64 indexed proofVersion)',
  'event FulfillmentProofApproved(uint256 indexed tokenId, bytes32 indexed proofDigest, bytes32 indexed approvalId, uint64 approvalVersion, address approver)',
  'event FulfillmentProofRejected(uint256 indexed tokenId, bytes32 indexed proofDigest, uint64 indexed proofVersion, bytes32 reasonHash)',
  'event RecoveryProposed(uint256 indexed tokenId, bytes32 indexed proposalHash, bytes32 indexed evidenceDigest, uint64 executeAfter, uint8 requiredApprovals, address proposer)',
  'event RecoveryApproved(uint256 indexed tokenId, bytes32 indexed proposalHash, address indexed approver, uint8 approvals)',
  'event RedemptionFinalized(uint256 indexed tokenId, uint256 indexed gemId, address indexed owner, bytes32 proofDigest, bytes32 approvalId, bytes32 authorizationNonce, bool recovered)',
  'function hasRole(bytes32 role,address account) view returns (bool)',
  'function recoveryProposal(uint256 tokenId) view returns ((bytes32 proposalHash,bytes32 evidenceDigest,uint64 proposedAt,uint64 executeAfter,uint8 requiredApprovals,uint8 approvals,bool executed))',
]);

/** The deployment's read client. Off Sepolia it never falls back to SEPOLIA_RPC_URL. */
export function redemptionReadClient() {
  return createPublicClient({
    transport: http(deploymentRpcUrl(), { timeout: 15_000, retryCount: 1 }),
  });
}

/**
 * The receipt for a hash a person submitted, with a clear error when the hash
 * is not a mined transaction (most often a Safe's off-chain safeTxHash).
 */
async function minedReceipt(publicClient: ReturnType<typeof redemptionReadClient>, hash: Hash) {
  try {
    return await publicClient.getTransactionReceipt({ hash });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'TransactionReceiptNotFoundError') throw error;
    const pending = await publicClient
      .getTransaction({ hash })
      .then(() => true)
      .catch(() => false);
    throw new Error(missingTransactionMessage(pending));
  }
}

function managerEvents(logs: Log[], manager: Address) {
  return parseEventLogs({
    abi: redemptionLifecycleAbi,
    logs: redemptionManagerLogs(logs, manager) as Log[],
    strict: true,
  });
}

/**
 * The manager's events in a confirmed transaction.
 *
 * With `expectedSender` the transaction must be that wallet's direct call to
 * the manager; server-signed steps are checked this way. With
 * `senderAttestedByEvents` the envelope is not checked, because the caller
 * binds the actor through event arguments the contract takes from `msg.sender`
 * (or through ownership the contract enforces). That also holds when a Safe or
 * a smart account executes the call, where `to`/`from` are not the wallet.
 */
export async function confirmedRedemptionEvents(input: {
  transactionHash: Hash;
  manager: Address;
  expectedSender?: Address;
  senderAttestedByEvents?: boolean;
  expectedChainId: number;
}) {
  const publicClient = redemptionReadClient();
  const chainId = await publicClient.getChainId();
  const receipt = await minedReceipt(publicClient, input.transactionHash);
  if (input.senderAttestedByEvents) {
    assertReceiptOutcome({
      chainId,
      expectedChainId: input.expectedChainId,
      status: receipt.status,
    });
  } else {
    assertReceiptEnvelope({
      chainId,
      expectedChainId: input.expectedChainId,
      status: receipt.status,
      to: receipt.to,
      manager: input.manager,
      from: receipt.from,
      expectedSender: input.expectedSender,
    });
  }
  return { receipt, logs: managerEvents(receipt.logs, input.manager) };
}

/** A recovery step validated from the manager's events, for an EOA or a Safe. */
export async function confirmedRecoveryStep(input: {
  transactionHash: Hash;
  manager: Address;
  approver: Address;
  expectedChainId: number;
  step: RecoveryStep;
}) {
  const publicClient = redemptionReadClient();
  const chainId = await publicClient.getChainId();
  const receipt = await minedReceipt(publicClient, input.transactionHash);
  return verifyRecoveryReceipt({
    chainId,
    expectedChainId: input.expectedChainId,
    status: receipt.status,
    from: receipt.from,
    manager: input.manager,
    approver: input.approver,
    rawLogs: receipt.logs,
    managerLogs: managerEvents(receipt.logs, input.manager),
    step: input.step,
  });
}

export function findEvent<T extends string>(
  logs: Array<{ eventName: string; args: unknown }>,
  eventName: T,
): { eventName: T; args: Record<string, unknown> } {
  const event = logs.find((entry) => entry.eventName === eventName);
  if (!event) throw new Error(`Confirmed transaction did not emit ${eventName}`);
  return event as { eventName: T; args: Record<string, unknown> };
}

export async function hasRedemptionRole(manager: Address, role: Hash, wallet: Address) {
  return redemptionReadClient().readContract({
    address: getAddress(manager),
    abi: redemptionLifecycleAbi,
    functionName: 'hasRole',
    args: [role, getAddress(wallet)],
  });
}

export async function recoveryProposal(manager: Address, tokenId: bigint) {
  return redemptionReadClient().readContract({
    address: getAddress(manager),
    abi: redemptionLifecycleAbi,
    functionName: 'recoveryProposal',
    args: [tokenId],
  });
}

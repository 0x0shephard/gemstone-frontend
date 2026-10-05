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
import {
  assertReceiptEnvelope,
  assertRedemptionEventArgs,
  redemptionManagerLogs,
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

function client() {
  const rpcUrl = Deno.env.get('RPC_URL')?.trim() || Deno.env.get('SEPOLIA_RPC_URL')?.trim();
  if (!rpcUrl) throw new Error('RPC_URL is not configured');
  return createPublicClient({ transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }) });
}

export async function confirmedRedemptionEvents(input: {
  transactionHash: Hash;
  manager: Address;
  expectedSender?: Address;
  expectedChainId: number;
}) {
  const publicClient = client();
  const chainId = await publicClient.getChainId();
  const receipt = await publicClient.getTransactionReceipt({ hash: input.transactionHash });
  assertReceiptEnvelope({
    chainId,
    expectedChainId: input.expectedChainId,
    status: receipt.status,
    to: receipt.to,
    manager: input.manager,
    from: receipt.from,
    expectedSender: input.expectedSender,
  });
  const logs = parseEventLogs({
    abi: redemptionLifecycleAbi,
    logs: redemptionManagerLogs(receipt.logs, input.manager) as Log[],
    strict: true,
  });
  return { receipt, logs };
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
  return client().readContract({
    address: getAddress(manager),
    abi: redemptionLifecycleAbi,
    functionName: 'hasRole',
    args: [role, getAddress(wallet)],
  });
}

export async function recoveryProposal(manager: Address, tokenId: bigint) {
  return client().readContract({
    address: getAddress(manager),
    abi: redemptionLifecycleAbi,
    functionName: 'recoveryProposal',
    args: [tokenId],
  });
}

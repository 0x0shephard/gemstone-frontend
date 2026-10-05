import { canonicalize } from './canonicalJson.ts';
import { keccak256, toBytes, type Address, type Hash } from 'npm:viem@2';

export type RedemptionLifecycleState =
  | 'onchain_requested'
  | 'custodian_collected'
  | 'custodian_dispatched'
  | 'bank_received'
  | 'pickup_handover_recorded'
  | 'pickup_proof_submitted'
  | 'delivery_proof_submitted'
  | 'proof_approved'
  | 'owner_authorized'
  | 'chain_burned'
  | 'cancelled';

export type FulfillmentMethod = 'pickup' | 'insured_delivery';

const transitionGraph: Record<RedemptionLifecycleState, readonly RedemptionLifecycleState[]> = {
  onchain_requested: ['custodian_collected', 'cancelled'],
  custodian_collected: ['custodian_dispatched'],
  custodian_dispatched: ['bank_received', 'delivery_proof_submitted'],
  bank_received: ['pickup_handover_recorded'],
  pickup_handover_recorded: ['pickup_proof_submitted'],
  pickup_proof_submitted: ['proof_approved'],
  delivery_proof_submitted: ['proof_approved'],
  proof_approved: ['owner_authorized'],
  owner_authorized: ['chain_burned'],
  chain_burned: [],
  cancelled: [],
};

export function assertRedemptionTransition(
  from: RedemptionLifecycleState,
  to: RedemptionLifecycleState,
  method: FulfillmentMethod,
): void {
  if (!transitionGraph[from]?.includes(to)) throw new Error(`Cannot move from ${from} to ${to}`);
  if (to === 'bank_received' && method !== 'pickup') {
    throw new Error('Bank receipt is only valid for pickup redemption');
  }
  if (to === 'delivery_proof_submitted' && method !== 'insured_delivery') {
    throw new Error('Courier delivery proof is only valid for insured delivery');
  }
}

export function redemptionSteps(method: FulfillmentMethod, state: RedemptionLifecycleState) {
  const path: RedemptionLifecycleState[] = [
    'onchain_requested',
    'custodian_collected',
    'custodian_dispatched',
    ...(method === 'pickup'
      ? (['bank_received', 'pickup_handover_recorded', 'pickup_proof_submitted'] as const)
      : (['delivery_proof_submitted'] as const)),
    'proof_approved',
    'owner_authorized',
    'chain_burned',
  ];
  const current = path.indexOf(state);
  return path.map((key, index) => ({
    key,
    state:
      state === 'cancelled'
        ? 'blocked'
        : index < current
          ? 'complete'
          : index === current
            ? 'current'
            : 'upcoming',
  }));
}

export interface ProxyCommitmentInput {
  deploymentId: string;
  requestId: string;
  requestHash: Hash;
  ownerWallet: Address;
  proxyName: string;
  proxyWallet: Address;
  identityEvidenceSha256: string;
}

export function proxyCollectorCommitment(input: ProxyCommitmentInput): {
  canonical: string;
  commitment: Hash;
  message: string;
} {
  const canonical = canonicalize({
    schema: 'digital-carat-proxy/v1',
    deploymentId: input.deploymentId,
    requestId: input.requestId,
    requestHash: input.requestHash.toLowerCase(),
    ownerWallet: input.ownerWallet.toLowerCase(),
    proxyName: input.proxyName.trim(),
    proxyWallet: input.proxyWallet.toLowerCase(),
    identityEvidenceSha256: input.identityEvidenceSha256.toLowerCase(),
  });
  const commitment = keccak256(toBytes(canonical));
  return {
    canonical,
    commitment,
    message: `Digital Carat proxy collector nomination\n${commitment}`,
  };
}

export function approvalBinding(input: {
  deploymentId: string;
  requestId: string;
  requestHash: Hash;
  proofDigest: Hash;
  proofVersion: bigint;
  projectionVersion: number;
  organizationId: string;
}): { canonical: string; approvalId: Hash; approvalVersion: bigint } {
  const approvalVersion = BigInt(input.projectionVersion + 1);
  const canonical = canonicalize({
    schema: 'digital-carat-redemption-approval/v1',
    deploymentId: input.deploymentId,
    requestId: input.requestId,
    requestHash: input.requestHash.toLowerCase(),
    proofDigest: input.proofDigest.toLowerCase(),
    proofVersion: input.proofVersion.toString(),
    approvalVersion: approvalVersion.toString(),
    organizationId: input.organizationId,
  });
  return { canonical, approvalId: keccak256(toBytes(canonical)), approvalVersion };
}

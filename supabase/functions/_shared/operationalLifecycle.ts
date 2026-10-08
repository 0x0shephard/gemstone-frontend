import { canonicalize } from './canonicalJson.ts';
import { keccak256, toBytes, type Address, type Hash } from 'npm:viem@2';

export {
  APPROVAL_PENDING_STATES,
  ARRIVAL_FROM_STATES,
  OWNER_CANCELLABLE_STATES,
  assertRedemptionTransition,
  redemptionSteps,
  type FulfillmentMethod,
  type RedemptionLifecycleState,
} from './redemptionFlow.ts';

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

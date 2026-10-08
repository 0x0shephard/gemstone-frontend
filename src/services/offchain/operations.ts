import { env } from '@/config/env';
import { requireClient } from './invoke';
import { invokeEdgeFunction } from './invoke';

export type OperationsCapability =
  | 'gemlab.read'
  | 'gemlab.appraise'
  | 'matrix.propose'
  | 'matrix.activate'
  | 'bank.receive'
  | 'custodian.fulfill'
  | 'admin.read'
  | 'admin.correct'
  | 'redemption.approve'
  | 'redemption.recover';

export interface OperationsMembership {
  organizationId: string;
  name: string;
  kind: 'lab' | 'gemlab' | 'bank' | 'custodian' | 'admin';
  role: string;
  capabilities: OperationsCapability[];
}

export interface OperationsAccess {
  memberships: OperationsMembership[];
  capabilities: OperationsCapability[];
}

export type WorkflowKind = 'seller' | 'redemption';

export interface WorkflowEventView {
  id: string;
  sequence: number;
  type: string;
  fromState: string | null;
  toState: string;
  occurredAt: string;
  actorLabel?: string;
  payload: Record<string, unknown>;
  supersedesEventId?: string | null;
  correctionReason?: string | null;
  txHash?: `0x${string}` | null;
}

export interface RedemptionStep {
  key: string;
  label: string;
  state: 'complete' | 'current' | 'upcoming' | 'blocked';
  occurredAt?: string;
  eventId?: string;
}

export interface RedemptionRecoveryView {
  proposalId: string;
  proposalHash: `0x${string}`;
  evidenceDigest: `0x${string}`;
  proposedAt?: string;
  executeAfter: string;
  requiredApprovals: number;
  approvals: number;
  state: 'proposed' | 'approved' | 'executed';
  transactionHash?: `0x${string}` | null;
  executedAt?: string | null;
}

export interface RedemptionTracker {
  id: string;
  tokenId: string;
  method: 'pickup' | 'insured_delivery';
  status: string;
  version: number;
  requestHash: `0x${string}` | null;
  workflowIdHash?: `0x${string}` | null;
  ownerWallet?: string;
  collectorCommitment?: `0x${string}` | null;
  proofDigest?: `0x${string}` | null;
  proofVersion?: number | null;
  proofApprovalId?: string | null;
  proofApprovalVersion?: number | null;
  proofApprovedAt?: string | null;
  updatedAt: string;
  recoveryEligibleAt: string | null;
  authorizationExpiresAt?: string | null;
  steps: RedemptionStep[];
  gem?: { tokenId: string; name: string; primaryImageUrl?: string };
  requestedAt?: string;
  events?: WorkflowEventView[];
  capabilities?: string[];
  fulfillmentDestination?: Record<string, unknown>;
  location?: string;
  evidence?: WorkflowEvidenceView[];
  recovery?: RedemptionRecoveryView | null;
  assignment?: {
    custodianOrganizationId?: string;
    bankOrganizationId?: string;
  } | null;
  /** Admin view: the active bank that recorded this stone's seller-cycle receipt. */
  storageBank?: { id: string; name: string } | null;
  proxyNomination?: RedemptionProxyNomination | null;
  /** Unexpired, server-issued finalization data; returned only to the owner. */
  authorization?: RedemptionAuthorization;
}

export interface RedemptionProxyNomination {
  id: string;
  proxyName: string;
  proxyWallet: string;
  collectorCommitment: `0x${string}`;
  identityEvidence: {
    id: string;
    mimeType: string;
    sha256: string;
    downloadUrl: string;
    expiresIn: number;
  };
  createdAt: string;
}

export interface WorkflowEvidenceView {
  id: string;
  category: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  createdAt?: string;
  state?: string;
  downloadUrl?: string;
}

export interface SellerWorkflowView {
  workflowId: string;
  submissionId: string;
  state: string;
  version: number;
  legacyBaseline: boolean;
  updatedAt: string;
  sellerName?: string;
  stoneName?: string;
  declaredCarats?: number;
  bankLocation?: string;
  bankReceivedAt?: string;
  appraisal?: GemAppraisalView | null;
  events: WorkflowEventView[];
  nextActions: string[];
}

export interface GemEvidenceView {
  id: string;
  category: string;
  fileName: string;
  mimeType: string;
  downloadUrl: string;
  eligibleAsPrimaryImage: boolean;
}

export interface GemLabQueueItem {
  submissionId: string;
  sellerName?: string;
  stoneName: string;
  carats?: number;
  submittedAt: string;
  state: string;
  certificateCount?: number;
  imageCount?: number;
}

export interface GemLabDetail {
  submission: GemLabQueueItem;
  evidence: GemEvidenceView[];
  workflow: SellerWorkflowView;
  currentAppraisal?: GemAppraisalView | null;
  matrix: AppraisalMatrix;
}

export interface GemGradeInput {
  variety: string;
  caratWeight: number;
  clarity: string;
  treatment: string;
  shape: string;
  color: string;
  colorGrade: string;
}

export interface GemAppraisalView {
  appraisalId: string;
  matrixVersion: string;
  matrixHash: string;
  approvedValuationUsd: string;
  breakdown: Record<string, unknown>;
}

export interface AppraisalMatrix {
  id?: string;
  version: string;
  state: 'draft' | 'proposed' | 'active' | 'retired';
  hash: string;
  document?: Record<string, unknown>;
  createdAt?: string;
  proposedAt?: string | null;
  activatedAt?: string | null;
}

export interface BankSellerQueueItem {
  submissionId: string;
  stoneName: string;
  sellerName?: string;
  state: string;
  version: number;
  submittedAt: string;
  appraisal?: GemAppraisalView | null;
}

export interface OperationsOverview {
  sellerWorkflows: SellerWorkflowView[];
  redemptionWorkflows: RedemptionTracker[];
  matrices: AppraisalMatrix[];
  organizations: OperationsOrganization[];
}

export interface OperationsOrganization {
  id: string;
  name: string;
  kind: 'custodian' | 'bank';
}

export async function loadOperationsAccess(): Promise<OperationsAccess | null> {
  try {
    const response = await invokeEdgeFunction<{ memberships: OperationsMembership[] }>(
      'v1-operations-capabilities',
    );
    if (response.memberships.length === 0) return null;
    return {
      memberships: response.memberships,
      capabilities: [...new Set(response.memberships.flatMap((entry) => entry.capabilities))],
    };
  } catch (error) {
    if (error instanceof Error && /not found|forbidden|unauthori[sz]ed/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

export async function loadGemLabQueue(): Promise<GemLabQueueItem[]> {
  const response = await invokeEdgeFunction<{ queue: GemLabQueueItem[] }>('v1-gemlab-workflow', {
    action: 'list',
  });
  return response.queue;
}

export async function loadGemLabDetail(submissionId: string): Promise<GemLabDetail> {
  return invokeEdgeFunction<GemLabDetail>('v1-gemlab-workflow', {
    action: 'detail',
    submissionId,
  });
}

export async function previewGemAppraisal(
  submissionId: string,
  graded: GemGradeInput,
  primaryImageId: string,
) {
  // The server validates the primary image for preview as well as appraise.
  return invokeEdgeFunction<GemAppraisalView>('v1-gemlab-workflow', {
    action: 'preview',
    submissionId,
    graded,
    primaryImageId,
  });
}

export async function submitGemAppraisal(input: {
  submissionId: string;
  graded: GemGradeInput;
  primaryImageId: string;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<GemAppraisalView & { workflow: SellerWorkflowView }> {
  return invokeEdgeFunction('v1-gemlab-workflow', { action: 'appraise', ...input });
}

export async function loadAppraisalMatrices(): Promise<AppraisalMatrix[]> {
  const response = await invokeEdgeFunction<{
    matrices: Array<{
      id: string;
      version: string;
      state: AppraisalMatrix['state'];
      matrix_hash: string;
      created_at: string;
      proposed_at: string | null;
      activated_at: string | null;
    }>;
  }>('v1-appraisal-matrix', { action: 'list' });
  return response.matrices.map((matrix) => ({
    id: matrix.id,
    version: matrix.version,
    state: matrix.state,
    hash: matrix.matrix_hash,
    createdAt: matrix.created_at,
    proposedAt: matrix.proposed_at,
    activatedAt: matrix.activated_at,
  }));
}

export async function createMatrixDraft(input: {
  version: string;
  document: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<{ matrix: AppraisalMatrix }> {
  return invokeEdgeFunction('v1-appraisal-matrix', { action: 'create_draft', ...input });
}

export async function proposeMatrix(matrixId: string): Promise<{ matrix: AppraisalMatrix }> {
  return invokeEdgeFunction('v1-appraisal-matrix', { action: 'propose', matrixId });
}

export async function activateMatrix(
  matrixId: string,
  expectedActiveVersion: string,
): Promise<{ matrix: AppraisalMatrix }> {
  return invokeEdgeFunction('v1-appraisal-matrix', {
    action: 'activate',
    matrixId,
    expectedActiveVersion,
  });
}

export async function loadBankSellerQueue(): Promise<BankSellerQueueItem[]> {
  const response = await invokeEdgeFunction<{ queue: BankSellerQueueItem[] }>('v1-bank-workflow', {
    action: 'seller_queue',
  });
  return response.queue;
}

export async function recordBankReceipt(input: {
  submissionId: string;
  expectedVersion: number;
  location: string;
  receivedAt: string;
  custodyStartedAt: string;
  conditionNotes: string;
  matchesDeclared: boolean;
  reserveEscrowEndsAt: string;
  idempotencyKey: string;
}): Promise<{ workflow: SellerWorkflowView }> {
  return invokeEdgeFunction('v1-bank-workflow', { action: 'record_receipt', ...input });
}

export async function loadAdminOverview(): Promise<OperationsOverview> {
  return invokeEdgeFunction<OperationsOverview>('v1-admin-operations', { action: 'overview' });
}

/**
 * Activation confirms up to six Sepolia transactions in sequence, which routinely
 * outlasts the default deadline. Match the Edge Function wall-clock limit instead.
 */
export const SELLER_ACTIVATION_DEADLINE_MS = 150_000;

export async function startSellerActivation(input: {
  submissionId: string;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<{ workflow: SellerWorkflowView }> {
  return invokeEdgeFunction(
    'v1-admin-operations',
    { action: 'start_seller_activation', ...input },
    SELLER_ACTIVATION_DEADLINE_MS,
  );
}

/**
 * Step 1: Digital Carat accepts an on-chain request. The storing bank comes from
 * the seller cycle; the admin names the custodian that delivers the stone.
 */
export async function acceptRedemption(input: {
  requestId: string;
  organizationId: string;
  expectedVersion: number;
  custodianOrganizationId: string;
  /** Only when no seller-cycle bank receipt names the storing bank. */
  bankOrganizationId?: string;
  idempotencyKey: string;
}): Promise<RedemptionMutationResult> {
  return mutateRedemptionLifecycle('accept_redemption', input);
}

/**
 * Approves the vault's arrival proof on-chain (server-signed) and emails the
 * holder the code they enter to confirm the handover.
 */
export async function releaseRedemptionOwnerCode(input: {
  requestId: string;
  organizationId: string;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<
  RedemptionMutationResult & {
    ownerCodeDelivery?: { status: 'sent' | 'retry_required'; expiresAt?: string; error?: string };
  }
> {
  return invokeEdgeFunction(
    'v1-redemption-lifecycle',
    { action: 'release_owner_code', ...input },
    SERVER_SIGNED_DEADLINE_MS,
  );
}

export async function correctWorkflow(input: {
  workflowKind: WorkflowKind;
  workflowId: string;
  expectedVersion: number;
  supersedesEventId: string;
  toState: string;
  reason: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<{ workflow: SellerWorkflowView | RedemptionTracker }> {
  return invokeEdgeFunction('v1-admin-operations', { action: 'correct', ...input });
}

export async function loadOwnerRedemptionTrackers(): Promise<RedemptionTracker[]> {
  return listRedemptionTrackers('owner');
}

export async function listRedemptionTrackers(
  scope: 'owner' | 'custodian' | 'bank' | 'admin',
  organizationId?: string,
): Promise<RedemptionTracker[]> {
  const response = await invokeEdgeFunction<{ requests: RedemptionTracker[] }>(
    'v1-redemption-lifecycle',
    { action: 'list', scope, ...(organizationId ? { organizationId } : {}) },
  );
  return response.requests;
}

export async function loadRedemptionTracker(
  requestId: string,
  organizationId?: string,
): Promise<RedemptionTracker> {
  const response = await invokeEdgeFunction<{
    request: RedemptionTracker;
    events: WorkflowEventView[];
    evidence: WorkflowEvidenceView[];
    capabilities: string[];
    recovery?: RedemptionRecoveryView | null;
    proxyNomination?: RedemptionProxyNomination | null;
  }>('v1-redemption-lifecycle', {
    action: 'detail',
    requestId,
    ...(organizationId ? { organizationId } : {}),
  });
  return {
    ...response.request,
    events: response.events,
    evidence: response.evidence,
    capabilities: response.capabilities,
    recovery: response.recovery ?? null,
    proxyNomination: response.proxyNomination ?? null,
  };
}

export interface RedemptionMutationResult {
  request: RedemptionTracker;
  event?: WorkflowEventView;
  chainAction?:
    | 'startFulfillment'
    | 'submitFulfillmentProof'
    | 'setCollectorCommitment'
    | 'approveFulfillmentProof'
    | 'cancelRedemption'
    | 'rejectFulfillmentProof'
    | 'proposeRecovery'
    | 'approveRecovery'
    | 'executeRecovery';
  args?: {
    tokenId: string;
    collectorCommitment?: `0x${string}`;
    proofDigest?: `0x${string}`;
    reasonHash?: `0x${string}`;
    evidenceDigest?: `0x${string}`;
    proposalHash?: `0x${string}`;
    approvalId?: `0x${string}`;
    approvalVersion?: number | string;
  };
}

export async function mutateRedemptionRecovery(
  action: 'propose_recovery' | 'approve_recovery' | 'execute_recovery',
  input: {
    requestId: string;
    organizationId: string;
    expectedVersion: number;
    idempotencyKey: string;
    recoveryWallet: string;
    evidenceId?: string;
    transactionHash?: `0x${string}`;
  },
): Promise<RedemptionMutationResult & { recovery?: RedemptionRecoveryView }> {
  return invokeEdgeFunction('v1-redemption-lifecycle', { action, ...input });
}

export async function mutateRedemptionLifecycle(
  action:
    | 'mark_onchain_requested'
    | 'discard_redemption'
    | 'accept_redemption'
    | 'custodian_collect'
    | 'custodian_dispatch'
    | 'record_arrival'
    | 'cancel_redemption'
    | 'nominate_proxy'
    | 'resend_owner_code'
    | 'authorize_owner'
    | 'mark_chain_burned',
  input: Record<string, unknown>,
  deadlineMs?: number,
): Promise<RedemptionMutationResult & { authorization?: RedemptionAuthorization }> {
  const body = { action, ...input };
  return deadlineMs
    ? invokeEdgeFunction('v1-redemption-lifecycle', body, deadlineMs)
    : invokeEdgeFunction('v1-redemption-lifecycle', body);
}

/**
 * The vault's confirm and arrival steps wait for a Sepolia transaction the
 * server signs, so they get the Edge Function wall-clock limit.
 */
export const SERVER_SIGNED_DEADLINE_MS = 150_000;

export async function markRedemptionOnchainRequested(input: {
  requestId: string;
  expectedVersion: 0;
  idempotencyKey: string;
  transactionHash: `0x${string}`;
}): Promise<RedemptionMutationResult> {
  return mutateRedemptionLifecycle('mark_onchain_requested', input);
}

export async function prepareRedemptionCancellation(input: {
  requestId: string;
  expectedVersion: number;
  idempotencyKey: string;
  transactionHash?: `0x${string}`;
}): Promise<RedemptionMutationResult> {
  return mutateRedemptionLifecycle('cancel_redemption', input);
}

/** Abandons a request that never opened on-chain (draft or committed). */
export async function discardRedemption(input: {
  requestId: string;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<RedemptionMutationResult> {
  return mutateRedemptionLifecycle('discard_redemption', input);
}

export async function prepareOwnerAuthorization(input: {
  requestId: string;
  code: string;
  ownerWallet: string;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<{ challenge: { id: string; message: string; expiresAt: string } }> {
  return invokeEdgeFunction('v1-redemption-lifecycle', {
    action: 'prepare_owner_authorization',
    ...input,
  });
}

export async function nominateRedemptionProxy(input: {
  requestId: string;
  expectedVersion: number;
  idempotencyKey: string;
  proxyName: string;
  proxyWallet: string;
  identityEvidenceId: string;
  collectorCommitment: `0x${string}`;
  ownerSignature: `0x${string}`;
  transactionHash?: `0x${string}`;
}): Promise<RedemptionMutationResult> {
  return mutateRedemptionLifecycle('nominate_proxy', input);
}

export async function authorizeRedemptionOwner(input: {
  requestId: string;
  challengeId: string;
  code: string;
  ownerWallet: string;
  ownerSignature: `0x${string}`;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<RedemptionMutationResult & { authorization: RedemptionAuthorization }> {
  return mutateRedemptionLifecycle('authorize_owner', input) as Promise<
    RedemptionMutationResult & { authorization: RedemptionAuthorization }
  >;
}

export async function resendRedemptionOwnerCode(input: {
  requestId: string;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<RedemptionMutationResult> {
  return mutateRedemptionLifecycle('resend_owner_code', input);
}

export async function markRedemptionChainBurned(input: {
  requestId: string;
  expectedVersion: number;
  idempotencyKey: string;
  transactionHash: `0x${string}`;
}): Promise<RedemptionMutationResult> {
  return mutateRedemptionLifecycle('mark_chain_burned', input);
}

/** Step 2: the storing bank confirms it holds the stone; the server starts fulfillment. */
export async function confirmVaultCollection(input: {
  requestId: string;
  organizationId: string;
  expectedVersion: number;
  note?: string;
  idempotencyKey: string;
}): Promise<RedemptionMutationResult> {
  return mutateRedemptionLifecycle('custodian_collect', input, SERVER_SIGNED_DEADLINE_MS);
}

/** Step 3: the bank records dispatch to the custodian, with evidence. */
export async function recordCustodianDispatch(input: {
  requestId: string;
  organizationId: string;
  expectedVersion: number;
  evidenceId: string;
  dispatchedAt: string;
  carrier?: string;
  trackingReference?: string;
  idempotencyKey: string;
}): Promise<RedemptionMutationResult> {
  return mutateRedemptionLifecycle('custodian_dispatch', input);
}

/** Step 4: the custodian records delivery; the server submits it as the on-chain proof. */
export async function recordRedemptionArrival(input: {
  requestId: string;
  organizationId: string;
  expectedVersion: number;
  evidenceId: string;
  arrivedAt: string;
  location: string;
  idempotencyKey: string;
}): Promise<RedemptionMutationResult> {
  return mutateRedemptionLifecycle('record_arrival', input, SERVER_SIGNED_DEADLINE_MS);
}

export interface PendingRedemptionAction {
  action: string;
  idempotencyKey: string;
  expectedVersion: number;
  payload: Record<string, unknown>;
  chainArguments: RedemptionMutationResult['args'];
  transactionHash: `0x${string}` | null;
  createdAt: string;
}

export async function resumeRedemptionActionIntent(input: {
  requestId: string;
  intentAction:
    | 'nominate_proxy'
    | 'cancel_redemption'
    | 'propose_recovery'
    | 'approve_recovery'
    | 'execute_recovery';
  organizationId?: string;
}): Promise<PendingRedemptionAction | null> {
  const response = await invokeEdgeFunction<{ pendingAction: PendingRedemptionAction | null }>(
    'v1-redemption-lifecycle',
    { action: 'resume_action_intent', ...input },
  );
  return response.pendingAction;
}

export interface RedemptionAuthorization {
  tokenId: string;
  owner: string;
  requestHash: `0x${string}`;
  workflowIdHash: `0x${string}`;
  proofDigest: `0x${string}`;
  proofVersion: number;
  approvalId: `0x${string}`;
  approvalVersion: number;
  collectorCommitment: `0x${string}`;
  nonce: `0x${string}`;
  issuedAt: number;
  deadline: number;
  authorizer: string;
  signature: `0x${string}`;
}

export async function prepareProxyNomination(input: {
  requestId: string;
  proxyName: string;
  proxyWallet: string;
  identityEvidenceId: string;
}): Promise<{ nomination: { collectorCommitment: `0x${string}`; message: string } }> {
  return invokeEdgeFunction('v1-redemption-lifecycle', {
    action: 'prepare_proxy_nomination',
    ...input,
  });
}

export type EvidenceCategory =
  | 'custodian_collection'
  | 'custodian_dispatch'
  | 'bank_receipt'
  | 'bank_handover'
  | 'courier_delivery'
  | 'redemption_arrival'
  | 'proxy_identity'
  | 'recovery_evidence'
  | 'admin_correction';

export async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function uploadRedemptionEvidence(input: {
  requestId: string;
  organizationId?: string;
  category: EvidenceCategory;
  file: File;
}): Promise<WorkflowEvidenceView> {
  const sha256 = await sha256File(input.file);
  const prepared = await invokeEdgeFunction<{
    evidence: WorkflowEvidenceView;
    upload: { bucket: 'workflow-evidence'; path: string; token: string };
  }>('v1-redemption-lifecycle', {
    action: 'request_evidence_upload',
    requestId: input.requestId,
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    category: input.category,
    fileName: input.file.name,
    mimeType: input.file.type,
    byteSize: input.file.size,
    sha256,
  });
  const { error } = await requireClient()
    .storage.from(prepared.upload.bucket)
    .uploadToSignedUrl(prepared.upload.path, prepared.upload.token, input.file, {
      contentType: input.file.type,
    });
  if (error) throw new Error(error.message);
  const confirmed = await invokeEdgeFunction<{ evidence: WorkflowEvidenceView }>(
    'v1-redemption-lifecycle',
    {
      action: 'confirm_evidence_upload',
      requestId: input.requestId,
      evidenceId: prepared.evidence.id,
    },
  );
  return confirmed.evidence;
}

const IDEMPOTENCY_PREFIX = `dc:operation-idempotency:${env.deploymentRelease ?? 'local'}:`;

export function operationIdempotencyKey(intent: string): string {
  const storageKey = `${IDEMPOTENCY_PREFIX}${intent}`;
  const stored = window.localStorage.getItem(storageKey);
  if (stored) return stored;
  const id = crypto.randomUUID();
  window.localStorage.setItem(storageKey, id);
  return id;
}

export function clearOperationIdempotencyKey(intent: string) {
  window.localStorage.removeItem(`${IDEMPOTENCY_PREFIX}${intent}`);
}

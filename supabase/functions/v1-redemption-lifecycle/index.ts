import { adminClient, audit, randomHex, requireUser, sha256 } from '../_shared/auth.ts';
import { json, preflight } from '../_shared/cors.ts';
import { requireProtocolDeployment, type ProtocolDeployment } from '../_shared/deployment.ts';
import { sendEmail, escapeHtml } from '../_shared/email.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import {
  allOperationalMemberships,
  isGlobalOperationalAdmin,
  type OperationalCapability,
  type OperationalMembership,
} from '../_shared/operations.ts';
import {
  APPROVAL_PENDING_STATES,
  ARRIVAL_FROM_STATES,
  OWNER_CANCELLABLE_STATES,
  approvalBinding,
  assertRedemptionTransition,
  proxyCollectorCommitment,
  redemptionSteps,
  type FulfillmentMethod,
  type RedemptionLifecycleState,
} from '../_shared/operationalLifecycle.ts';
import { stableRecoveryEligibleAt } from '../_shared/approvalIntent.ts';
import { operatorChain, type OperatorChain } from '../_shared/chain.ts';
import {
  ChainPhase,
  OperatorBusyError,
  assertOperatorIsCustodian,
  proofApproverChain,
  readRedemptionRecord,
  sendRedemptionWrite,
} from '../_shared/redemptionOperator.ts';
import {
  deriveOwnerCode,
  ownerAuthorizationChallenge,
  ownerCodeHash,
} from '../_shared/redemptionAuthorization.ts';
import {
  assertRedemptionEventArgs,
  confirmedRedemptionEvents,
  findEvent,
  hasRedemptionRole,
  recoveryProposal as loadChainRecoveryProposal,
} from '../_shared/redemptionChain.ts';
import {
  effectiveWorkflowTimeline,
  appendWorkflowEvent,
  loadProjection,
  workflowTimeline,
} from '../_shared/workflowEvents.ts';
import { canonicalize } from 'npm:json-canonicalize@1.1.0';
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  toBytes,
  verifyMessage,
  zeroHash,
  type Address,
  type Hash,
} from 'npm:viem@2';
import { privateKeyToAccount } from 'npm:viem@2/accounts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const TX_HASH = /^0x[0-9a-f]{64}$/i;
const EVIDENCE_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const OWNER_OF_ABI = parseAbi(['function ownerOf(uint256 tokenId) view returns (address)']);

type RedemptionRow = {
  id: string;
  requester_id: string;
  requester_wallet: string;
  token_id: string | number;
  gem_id: string | number;
  fulfillment_method: FulfillmentMethod;
  fulfillment_details: Record<string, unknown>;
  status: string;
  request_hash: Hash | null;
  transaction_hash: Hash | null;
  collector_commitment: Hash | null;
  proof_digest: Hash | null;
  proof_version: number | string | null;
  proof_approval_id: Hash | null;
  proof_approval_version: number | string | null;
  proof_approved_at: string | null;
  recovery_eligible_at: string | null;
  authorization_expires_at: string | null;
  authorization_payload?: Record<string, unknown> | null;
  authorization_signature?: Hash | null;
  authorization_authorizer?: Address | null;
  updated_at: string;
  created_at: string;
};

function requiredUuid(value: unknown, label: string): string {
  const parsed = String(value ?? '');
  if (!UUID.test(parsed)) throw new Error(`${label} must be a UUID`);
  return parsed;
}

function requiredVersion(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('expectedVersion is invalid');
  return parsed;
}

function requiredHash(value: unknown, label = 'Transaction hash'): Hash {
  const parsed = String(value ?? '');
  if (!TX_HASH.test(parsed)) throw new Error(`${label} is invalid`);
  return parsed as Hash;
}

function requiredInstant(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO date`);
  }
  const parsed = new Date(value);
  if (parsed.getTime() > Date.now() + 5 * 60_000)
    throw new Error(`${label} cannot be in the future`);
  return parsed.toISOString();
}

function safeFileName(value: unknown): string {
  const parsed = String(value ?? '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._ -]/g, '-')
    .trim()
    .slice(-180);
  if (!parsed) throw new Error('File name is required');
  return parsed;
}

function workflowIdHash(id: string): Hash {
  return keccak256(toBytes(id));
}

function abstractCapabilities(memberships: OperationalMembership[]): Set<OperationalCapability> {
  return new Set(memberships.flatMap((membership) => membership.capabilities));
}

function membershipFor(
  memberships: OperationalMembership[],
  capability: OperationalCapability,
  organizationId?: string,
): OperationalMembership | null {
  return (
    memberships.find(
      (membership) =>
        membership.capabilities.includes(capability) &&
        (!organizationId || membership.organizationId === organizationId),
    ) ?? null
  );
}

async function requireAssignment(
  admin: ReturnType<typeof adminClient>,
  deploymentId: string,
  requestId: string,
  assignmentRole: 'custodian' | 'bank',
  membership: OperationalMembership,
) {
  // An explicit admin-organization administrator is the audited break-glass
  // operator. Every other operational actor remains bound to its assignment.
  if (isGlobalOperationalAdmin(membership)) return;
  const { data, error } = await admin
    .from('redemption_workflow_assignments')
    .select('id')
    .eq('deployment_id', deploymentId)
    .eq('redemption_request_id', requestId)
    .eq('assignment_role', assignmentRole)
    .eq('organization_id', membership.organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Not found');
}

function currentActions(
  row: RedemptionRow,
  owner: boolean,
  capabilities: Set<OperationalCapability>,
): string[] {
  const status = row.status as RedemptionLifecycleState;
  const vault = capabilities.has('custodian.fulfill');
  const actions = ['request_evidence_upload', 'confirm_evidence_upload'];
  if (owner && ['draft', 'committed'].includes(row.status)) actions.push('discard_redemption');
  if (owner && row.status === 'committed') actions.push('mark_onchain_requested');
  if (owner && OWNER_CANCELLABLE_STATES.includes(status)) {
    actions.push('prepare_proxy_nomination', 'nominate_proxy', 'cancel_redemption');
  }
  if (capabilities.has('redemption.approve') && status === 'onchain_requested') {
    actions.push('accept_redemption');
  }
  if (vault && status === 'accepted') actions.push('custodian_collect');
  if (vault && status === 'custodian_collected') actions.push('custodian_dispatch');
  if (vault && ARRIVAL_FROM_STATES.includes(status)) actions.push('record_arrival');
  if (
    (vault || capabilities.has('redemption.approve')) &&
    APPROVAL_PENDING_STATES.includes(status)
  ) {
    actions.push('release_owner_code');
  }
  if (owner && ['proof_approved', 'owner_authorized'].includes(row.status)) {
    actions.push('resend_owner_code', 'prepare_owner_authorization', 'authorize_owner');
  }
  if (owner && row.status === 'owner_authorized') actions.push('mark_chain_burned');
  if (
    capabilities.has('redemption.recover') &&
    ['proof_approved', 'owner_authorized'].includes(row.status)
  ) {
    actions.push('propose_recovery', 'approve_recovery', 'execute_recovery');
  }
  return actions;
}

function eventView(event: Record<string, unknown>, includePayload = true) {
  return {
    id: event.id,
    sequence: Number(event.sequence),
    type: event.event_type,
    fromState: event.from_state,
    toState: event.to_state,
    occurredAt: event.occurred_at,
    payload: includePayload ? (event.payload ?? {}) : {},
    txHash: event.transaction_hash,
    supersedesEventId: event.supersedes_event_id,
    correctionReason: event.correction_reason,
  };
}

function tracker(row: RedemptionRow, version: number, events: Array<Record<string, unknown>> = []) {
  const eventByState = new Map(events.map((event) => [String(event.to_state), event]));
  return {
    id: row.id,
    tokenId: String(row.token_id),
    method: row.fulfillment_method,
    status: row.status,
    version,
    requestHash: row.request_hash,
    workflowIdHash: workflowIdHash(row.id),
    ownerWallet: row.requester_wallet,
    collectorCommitment: row.collector_commitment,
    proofDigest: row.proof_digest,
    proofVersion: row.proof_version === null ? null : Number(row.proof_version),
    proofApprovalId: row.proof_approval_id,
    proofApprovalVersion:
      row.proof_approval_version === null ? null : Number(row.proof_approval_version),
    proofApprovedAt: row.proof_approved_at,
    recoveryEligibleAt: row.recovery_eligible_at,
    authorizationExpiresAt: row.authorization_expires_at,
    updatedAt: row.updated_at,
    requestedAt: row.created_at,
    steps: redemptionSteps(row.fulfillment_method, row.status as RedemptionLifecycleState).map(
      ({ completedBy, ...step }) => {
        const event = eventByState.get(completedBy);
        return {
          ...step,
          ...(event ? { occurredAt: event.occurred_at, eventId: event.id } : {}),
        };
      },
    ),
  };
}

async function requestRow(admin: ReturnType<typeof adminClient>, deploymentId: string, id: string) {
  const { data, error } = await admin
    .from('redemption_requests')
    .select(
      'id,requester_id,requester_wallet,token_id::text,gem_id::text,fulfillment_method,' +
        'fulfillment_details,status,request_hash,transaction_hash,collector_commitment,proof_digest,' +
        'proof_version,proof_approval_id,proof_approval_version,proof_approved_at,recovery_eligible_at,' +
        'authorization_expires_at,authorization_payload,authorization_signature,authorization_authorizer,' +
        'updated_at,created_at',
    )
    .eq('deployment_id', deploymentId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as RedemptionRow | null;
}

async function projectionVersion(
  admin: ReturnType<typeof adminClient>,
  deploymentId: string,
  requestId: string,
) {
  const projection = await loadProjection(admin, deploymentId, 'redemption', requestId);
  return { projection, version: projection ? Number(projection.version) : 0 };
}

async function evidence(
  admin: ReturnType<typeof adminClient>,
  deploymentId: string,
  requestId: string,
  id: string,
  category?: string,
) {
  let query = admin
    .from('workflow_evidence')
    .select('*')
    .eq('deployment_id', deploymentId)
    .eq('workflow_kind', 'redemption')
    .eq('workflow_id', requestId)
    .eq('id', id)
    .not('verified_at', 'is', null);
  if (category) query = query.eq('category', category);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Verified workflow evidence was not found');
  return data;
}

async function complete(input: {
  admin: ReturnType<typeof adminClient>;
  deploymentId: string;
  row: RedemptionRow;
  expectedVersion: number;
  expectedState: string;
  eventType: string;
  toState: string;
  userId: string;
  membership?: OperationalMembership | null;
  capability: string;
  payload: Record<string, unknown>;
  transactionHash?: Hash | null;
  idempotencyKey: string;
}) {
  const { data, error } = await input.admin.rpc('complete_redemption_transition', {
    p_deployment_id: input.deploymentId,
    p_request_id: input.row.id,
    p_expected_version: input.expectedVersion,
    p_expected_state: input.expectedState,
    p_event_type: input.eventType,
    p_to_state: input.toState,
    p_actor_profile_id: input.userId,
    p_actor_organization_id: input.membership?.organizationId ?? null,
    p_actor_capability: input.capability,
    p_payload: input.payload,
    p_transaction_hash: input.transactionHash ?? null,
    p_idempotency_key: input.idempotencyKey,
    p_legacy_baseline: input.expectedVersion === 0,
  });
  if (error) throw error;
  return data as RedemptionRow;
}

async function storeIntent(input: {
  admin: ReturnType<typeof adminClient>;
  deploymentId: string;
  requestId: string;
  action: string;
  idempotencyKey: string;
  expectedVersion: number;
  payload: Record<string, unknown>;
  chainArguments?: Record<string, unknown>;
}) {
  const existing = await loadIntent(
    input.admin,
    input.deploymentId,
    input.requestId,
    input.idempotencyKey,
  );
  if (existing) {
    if (
      existing.action !== input.action ||
      canonicalize(existing.payload) !== canonicalize(input.payload)
    ) {
      throw new Error('Idempotency key is already bound to different input');
    }
    return existing;
  }
  const { data, error } = await input.admin
    .from('redemption_action_intents')
    .insert({
      deployment_id: input.deploymentId,
      redemption_request_id: input.requestId,
      action: input.action,
      idempotency_key: input.idempotencyKey,
      expected_version: input.expectedVersion,
      payload: input.payload,
      chain_arguments: input.chainArguments ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function loadIntent(
  admin: ReturnType<typeof adminClient>,
  deploymentId: string,
  requestId: string,
  idempotencyKey: string,
) {
  const { data, error } = await admin
    .from('redemption_action_intents')
    .select('*')
    .eq('deployment_id', deploymentId)
    .eq('redemption_request_id', requestId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function codeSettings(admin: ReturnType<typeof adminClient>) {
  const { data, error } = await admin
    .from('operational_settings')
    .select('key,value')
    .in('key', [
      'redemption_owner_code_ttl_seconds',
      'redemption_owner_code_resend_seconds',
      'redemption_recovery_grace_seconds',
    ]);
  if (error) throw error;
  const values = new Map((data ?? []).map((row) => [row.key, Number(row.value)]));
  return {
    ttl: values.get('redemption_owner_code_ttl_seconds') ?? 900,
    resend: values.get('redemption_owner_code_resend_seconds') ?? 60,
    grace: Math.max(604800, values.get('redemption_recovery_grace_seconds') ?? 604800),
  };
}

async function deliverOwnerCode(
  admin: ReturnType<typeof adminClient>,
  deploymentId: string,
  row: RedemptionRow,
  forceNew = false,
) {
  const secret = Deno.env.get('REDEMPTION_CODE_SECRET')?.trim();
  if (!secret) throw new Error('Redemption owner-code delivery is not configured');
  const settings = await codeSettings(admin);
  const { data: authUser, error: userError } = await admin.auth.admin.getUserById(row.requester_id);
  if (userError) throw userError;
  const email = authUser.user?.email;
  if (!email || !authUser.user.email_confirmed_at) {
    throw new Error('The token owner needs a verified email before approval can be delivered');
  }
  const { data: existing, error: codeError } = await admin
    .from('redemption_owner_codes')
    .select('*')
    .eq('deployment_id', deploymentId)
    .eq('redemption_request_id', row.id)
    .is('invalidated_at', null)
    .maybeSingle();
  if (codeError) throw codeError;
  const now = Date.now();
  let codeRow = existing;
  if (existing && forceNew && Date.parse(existing.expires_at) > now) {
    if (existing.sent_at && Date.parse(existing.sent_at) + settings.resend * 1_000 > now) {
      throw new Error('Wait before requesting another owner-code email');
    }
  }
  if (!existing || Date.parse(existing.expires_at) <= now) {
    if (existing) {
      const { error } = await admin
        .from('redemption_owner_codes')
        .update({ invalidated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .is('invalidated_at', null);
      if (error) throw error;
    }
    const generationId = crypto.randomUUID();
    const code = await deriveOwnerCode(secret, generationId);
    const hash = await ownerCodeHash(secret, row.id, code);
    const { data, error } = await admin
      .from('redemption_owner_codes')
      .insert({
        deployment_id: deploymentId,
        redemption_request_id: row.id,
        generation_id: generationId,
        code_hash: hash,
        expires_at: new Date(now + settings.ttl * 1_000).toISOString(),
      })
      .select('*')
      .single();
    if (error) throw error;
    codeRow = data;
  }
  const code = await deriveOwnerCode(secret, codeRow.generation_id);
  const providerMessageId = await sendEmail({
    to: email,
    subject: 'Your Digital Carat redemption authorization code',
    text: `Your one-time redemption authorization code is ${code}. It expires at ${codeRow.expires_at}. Never share it with a custodian or courier.`,
    html: `<p>Your one-time redemption authorization code is <strong>${escapeHtml(code)}</strong>.</p><p>It expires at ${escapeHtml(codeRow.expires_at)}. Never share it with a custodian or courier.</p>`,
    idempotencyKey: `redemption-owner-code/${deploymentId}/${codeRow.generation_id}`,
  });
  const { error: updateError } = await admin
    .from('redemption_owner_codes')
    .update({ sent_at: new Date().toISOString(), provider_message_id: providerMessageId || null })
    .eq('id', codeRow.id);
  if (updateError) throw updateError;
  return { expiresAt: codeRow.expires_at };
}

async function verifiedCurrentOwner(
  deployment: ProtocolDeployment,
  row: RedemptionRow,
): Promise<Address> {
  const rpcUrl = Deno.env.get('RPC_URL')?.trim() || Deno.env.get('SEPOLIA_RPC_URL')?.trim();
  if (!rpcUrl) throw new Error('RPC_URL is not configured');
  const client = createPublicClient({
    transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }),
  });
  return (await client.readContract({
    address: getAddress(deployment.dge_nft_address),
    abi: OWNER_OF_ABI,
    functionName: 'ownerOf',
    args: [BigInt(row.token_id)],
  })) as Address;
}

async function verifiedActingWallet(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  value: unknown,
): Promise<Address> {
  const wallet = String(value ?? '');
  if (!isAddress(wallet)) throw new Error('A verified acting wallet is required');
  const normalized = wallet.toLowerCase();
  const { data, error } = await admin
    .from('wallet_links')
    .select('id')
    .eq('profile_id', userId)
    .eq('wallet_address', normalized)
    .not('verified_at', 'is', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('The acting wallet is not verified for this account');
  return getAddress(wallet);
}

function assertEventValue(actual: unknown, expected: string | bigint, label: string) {
  assertRedemptionEventArgs({ [label]: actual }, { [label]: expected });
}

async function receiptEvents(
  deployment: ProtocolDeployment,
  transactionHash: Hash,
  expectedSender?: Address,
) {
  return confirmedRedemptionEvents({
    transactionHash,
    manager: getAddress(deployment.redemption_manager_address),
    expectedSender,
    expectedChainId: Number(deployment.chain_id),
  });
}

const AUTHORIZER_ROLE = keccak256(toBytes('AUTHORIZER_ROLE'));
/** Covers block-time lag and server clock skew; see the owner authorization. */
const AUTHORIZATION_BACKDATE_SECONDS = 120n;
const RECOVERY_APPROVER_ROLE = keccak256(toBytes('RECOVERY_APPROVER_ROLE'));

async function configuredAuthorizer(deployment: ProtocolDeployment) {
  const key = Deno.env.get('REDEMPTION_AUTHORIZER_PRIVATE_KEY')?.trim() as Hash | undefined;
  const configuredAddress = Deno.env.get('REDEMPTION_AUTHORIZER_ADDRESS')?.trim();
  if (
    !key ||
    !/^0x[0-9a-f]{64}$/i.test(key) ||
    !configuredAddress ||
    !isAddress(configuredAddress)
  ) {
    throw new Error('Redemption authorizer is not configured');
  }
  const account = privateKeyToAccount(key);
  if (account.address.toLowerCase() !== configuredAddress.toLowerCase()) {
    throw new Error('Redemption authorizer key does not match its configured address');
  }
  if (
    !(await hasRedemptionRole(
      getAddress(deployment.redemption_manager_address),
      AUTHORIZER_ROLE,
      account.address,
    ))
  ) {
    throw new Error('Configured redemption authorizer does not have AUTHORIZER_ROLE');
  }
  return account;
}

async function assertRecoveryApprover(deployment: ProtocolDeployment, wallet: Address) {
  const manager = getAddress(deployment.redemption_manager_address);
  const authorizer = await configuredAuthorizer(deployment);
  if (wallet.toLowerCase() === authorizer.address.toLowerCase()) {
    throw new Error('Recovery approver and authorization signer must be distinct');
  }
  if (!(await hasRedemptionRole(manager, RECOVERY_APPROVER_ROLE, wallet))) {
    throw new Error('Acting wallet does not have RECOVERY_APPROVER_ROLE');
  }
}

function manager(deployment: ProtocolDeployment): Address {
  return getAddress(deployment.redemption_manager_address);
}

/** The operator chain, refusing an RPC that points at a different network. */
function serverChain(deployment: ProtocolDeployment): OperatorChain {
  const chain = operatorChain();
  if (String(chain.chainId) !== String(deployment.chain_id)) {
    throw new Error('Operator RPC chain does not match the protocol deployment');
  }
  return chain;
}

/**
 * Sends one server-signed RedemptionManager write for an action intent, or
 * recognises that an earlier attempt already landed it.
 *
 * The contract phase is the source of truth: at `fromPhase` the write is still
 * owed; past it, a previous attempt succeeded (its hash, when it was recorded,
 * is reused for the event). Anything else means the workflow and the chain
 * disagree and nothing is sent.
 */
async function runServerStep(input: {
  admin: ReturnType<typeof adminClient>;
  deployment: ProtocolDeployment;
  requestId: string;
  idempotencyKey: string;
  tokenId: bigint;
  signer: OperatorChain;
  operator: OperatorChain;
  functionName: 'startFulfillment' | 'submitFulfillmentProof' | 'approveFulfillmentProof';
  args: readonly unknown[];
  fromPhase: number;
  expectedEvent: string;
}): Promise<Hash | null> {
  const record = await readRedemptionRecord(
    input.operator,
    manager(input.deployment),
    input.tokenId,
  );
  if (record.workflowIdHash.toLowerCase() !== workflowIdHash(input.requestId).toLowerCase()) {
    throw new Error('The on-chain redemption belongs to a different workflow');
  }
  if (record.phase > input.fromPhase && record.phase !== ChainPhase.Completed) {
    const intent = await loadIntent(
      input.admin,
      input.deployment.id,
      input.requestId,
      input.idempotencyKey,
    );
    return (intent?.transaction_hash as Hash | null | undefined) ?? null;
  }
  if (record.phase !== input.fromPhase) {
    throw new Error(`The on-chain redemption is not ready for ${input.functionName}`);
  }
  const hash = await sendRedemptionWrite({
    admin: input.admin,
    chain: input.signer,
    operator: input.operator,
    manager: manager(input.deployment),
    functionName: input.functionName,
    args: input.args,
    onSubmitted: async (submitted) => {
      const { error } = await input.admin
        .from('redemption_action_intents')
        .update({ transaction_hash: submitted.toLowerCase() })
        .eq('deployment_id', input.deployment.id)
        .eq('redemption_request_id', input.requestId)
        .eq('idempotency_key', input.idempotencyKey);
      if (error) throw error;
    },
  });
  const chain = await receiptEvents(input.deployment, hash, input.signer.account.address);
  const emitted = findEvent(chain.logs, input.expectedEvent);
  assertEventValue(emitted.args.tokenId, input.tokenId.toString(), 'token');
  return hash.toLowerCase() as Hash;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const deployment = await requireProtocolDeployment(admin, request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? 'list');
    const organizationId =
      typeof body.organizationId === 'string' ? body.organizationId : undefined;
    const memberships = await allOperationalMemberships(admin, user.id);
    const abstract = abstractCapabilities(memberships);

    if (action === 'list') {
      const scope = String(body.scope ?? 'owner');
      let query = admin
        .from('redemption_requests')
        .select(
          'id,requester_id,requester_wallet,token_id::text,gem_id::text,fulfillment_method,' +
            'fulfillment_details,status,request_hash,transaction_hash,collector_commitment,proof_digest,' +
            'proof_version,proof_approval_id,proof_approval_version,proof_approved_at,recovery_eligible_at,' +
            'authorization_expires_at,authorization_payload,authorization_signature,authorization_authorizer,' +
            'updated_at,created_at',
        )
        .eq('deployment_id', deployment.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (scope === 'owner') query = query.eq('requester_id', user.id);
      else if (scope === 'custodian' && abstract.has('custodian.fulfill')) {
        const membership = membershipFor(memberships, 'custodian.fulfill', organizationId);
        if (!membership) return json({ error: 'Not found' }, 404);
        query = query.in('status', [
          'accepted',
          'custodian_collected',
          'custodian_dispatched',
          'arrived',
          'bank_received',
          'pickup_handover_recorded',
          'pickup_proof_submitted',
          'delivery_proof_submitted',
          'proof_approved',
          'owner_authorized',
        ]);
        if (!isGlobalOperationalAdmin(membership)) {
          const { data: assignments, error: assignmentError } = await admin
            .from('redemption_workflow_assignments')
            .select('redemption_request_id')
            .eq('deployment_id', deployment.id)
            .eq('assignment_role', 'custodian')
            .eq('organization_id', membership.organizationId);
          if (assignmentError) throw assignmentError;
          if (!assignments?.length) return json({ requests: [] });
          query = query.in(
            'id',
            assignments.map((item) => item.redemption_request_id),
          );
        }
      } else if (scope === 'bank' && abstract.has('bank.receive')) {
        const membership = membershipFor(memberships, 'bank.receive', organizationId);
        if (!membership) return json({ error: 'Not found' }, 404);
        query = query
          .eq('fulfillment_method', 'pickup')
          .in('status', [
            'custodian_dispatched',
            'bank_received',
            'pickup_handover_recorded',
            'pickup_proof_submitted',
            'proof_approved',
          ]);
        if (!isGlobalOperationalAdmin(membership)) {
          const { data: assignments, error: assignmentError } = await admin
            .from('redemption_workflow_assignments')
            .select('redemption_request_id')
            .eq('deployment_id', deployment.id)
            .eq('assignment_role', 'bank')
            .eq('organization_id', membership.organizationId);
          if (assignmentError) throw assignmentError;
          if (!assignments?.length) return json({ requests: [] });
          query = query.in(
            'id',
            assignments.map((item) => item.redemption_request_id),
          );
        }
      } else if (scope !== 'admin' || !abstract.has('admin.read')) {
        return json({ error: 'Not found' }, 404);
      }
      const { data, error } = await query;
      if (error) throw error;
      const requests = await Promise.all(
        ((data ?? []) as RedemptionRow[]).map(async (row) => {
          const { version } = await projectionVersion(admin, deployment.id, row.id);
          return tracker(row, version);
        }),
      );
      return json({ requests });
    }

    const requestId = requiredUuid(body.requestId, 'requestId');
    let row = await requestRow(admin, deployment.id, requestId);
    if (!row) return json({ error: 'Redemption request not found' }, 404);
    const owner = row.requester_id === user.id;
    if (body.transactionHash && UUID.test(String(body.idempotencyKey ?? ''))) {
      const submittedHash = requiredHash(body.transactionHash);
      const replayKey = String(body.idempotencyKey);
      const { data: completedIntent, error: completedIntentError } = await admin
        .from('redemption_action_intents')
        .select('action,transaction_hash,completed_at')
        .eq('deployment_id', deployment.id)
        .eq('redemption_request_id', requestId)
        .eq('idempotency_key', replayKey)
        .maybeSingle();
      if (completedIntentError) throw completedIntentError;
      if (completedIntent?.completed_at) {
        if (
          completedIntent.action !== action ||
          completedIntent.transaction_hash?.toLowerCase() !== submittedHash.toLowerCase()
        ) {
          return json({ error: 'Idempotency key is already bound to different input' }, 409);
        }
        const currentProjection = await projectionVersion(admin, deployment.id, requestId);
        const { data: recoveredProposal, error: recoveredProposalError } = await admin
          .from('redemption_recovery_proposals')
          .select('*')
          .eq('deployment_id', deployment.id)
          .eq('redemption_request_id', requestId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (recoveredProposalError) throw recoveredProposalError;
        return json({
          request: tracker(row, currentProjection.version),
          recovery: recoveredProposal,
          resumed: true,
        });
      }
    }
    if (action === 'detail') {
      const adminView = abstract.has('admin.read');
      const custodianMembership = membershipFor(memberships, 'custodian.fulfill', organizationId);
      const bankMembership = membershipFor(memberships, 'bank.receive', organizationId);
      let custodianView = false;
      let bankView = false;
      if (!owner && !adminView && custodianMembership) {
        await requireAssignment(admin, deployment.id, requestId, 'custodian', custodianMembership);
        custodianView = true;
      }
      if (!owner && !adminView && bankMembership && row.fulfillment_method === 'pickup') {
        await requireAssignment(admin, deployment.id, requestId, 'bank', bankMembership);
        bankView = true;
      }
      if (!owner && !adminView && !custodianView && !bankView) {
        return json({ error: 'Not found' }, 404);
      }
      const { projection, version } = await projectionVersion(admin, deployment.id, requestId);
      const timeline = adminView
        ? await workflowTimeline(admin, deployment.id, 'redemption', requestId)
        : await effectiveWorkflowTimeline(admin, deployment.id, 'redemption', requestId);
      const events = timeline.map((event) =>
        eventView(event as Record<string, unknown>, adminView || custodianView || bankView),
      );
      let assignment: {
        custodianOrganizationId?: string;
        bankOrganizationId?: string;
      } | null = null;
      const { data: storedAssignments, error: assignmentError } = await admin
        .from('redemption_workflow_assignments')
        .select('assignment_role,organization_id')
        .eq('deployment_id', deployment.id)
        .eq('redemption_request_id', requestId);
      if (assignmentError) throw assignmentError;
      if (storedAssignments?.length) {
        assignment = {};
        for (const storedAssignment of storedAssignments) {
          if (storedAssignment.assignment_role === 'custodian') {
            assignment.custodianOrganizationId = storedAssignment.organization_id;
          } else if (storedAssignment.assignment_role === 'bank') {
            assignment.bankOrganizationId = storedAssignment.organization_id;
          }
        }
      }
      const { data: storedEvidence, error } = await admin
        .from('workflow_evidence')
        .select('id,category,file_name,mime_type,byte_size,sha256,created_at,verified_at')
        .eq('deployment_id', deployment.id)
        .eq('workflow_kind', 'redemption')
        .eq('workflow_id', requestId)
        .not('verified_at', 'is', null)
        .order('created_at');
      if (error) throw error;
      const safeEvidence = await Promise.all(
        (storedEvidence ?? [])
          .filter((item) => {
            if (adminView) return true;
            if (owner) return item.category === 'proxy_identity';
            if (custodianView)
              return [
                'custodian_collection',
                'custodian_dispatch',
                'courier_delivery',
                'redemption_arrival',
                'bank_handover',
              ].includes(item.category);
            return (
              bankView &&
              ['bank_receipt', 'bank_handover', 'proxy_identity'].includes(item.category)
            );
          })
          .map(async (item) => {
            let downloadUrl: string | undefined;
            if (adminView || (bankView && item.category === 'proxy_identity')) {
              const { data: full } = await admin
                .from('workflow_evidence')
                .select('bucket,object_path')
                .eq('id', item.id)
                .single();
              const { data: signed, error: signedError } = await admin.storage
                .from(full.bucket)
                .createSignedUrl(full.object_path, 300);
              if (signedError) throw signedError;
              downloadUrl = signed.signedUrl;
            }
            return {
              id: item.id,
              category: item.category,
              mimeType: item.mime_type,
              byteSize: Number(item.byte_size),
              ...(owner ? {} : { sha256: item.sha256 }),
              createdAt: item.created_at,
              state: 'verified',
              ...(downloadUrl ? { downloadUrl } : {}),
            };
          }),
      );
      let proxyNomination: Record<string, unknown> | null = null;
      if (bankView || adminView) {
        const { data: nomination, error: nominationError } = await admin
          .from('redemption_proxy_nominations')
          .select(
            'id,proxy_name,proxy_wallet,collector_commitment,identity_evidence_id,state,created_at',
          )
          .eq('deployment_id', deployment.id)
          .eq('redemption_request_id', requestId)
          .eq('state', 'approved')
          .maybeSingle();
        if (nominationError) throw nominationError;
        if (nomination) {
          const identity = await evidence(
            admin,
            deployment.id,
            requestId,
            nomination.identity_evidence_id,
            'proxy_identity',
          );
          const { data: signed, error: signedError } = await admin.storage
            .from(identity.bucket)
            .createSignedUrl(identity.object_path, 300);
          if (signedError) throw signedError;
          proxyNomination = {
            id: nomination.id,
            proxyName: nomination.proxy_name,
            proxyWallet: nomination.proxy_wallet,
            collectorCommitment: nomination.collector_commitment,
            identityEvidence: {
              id: identity.id,
              mimeType: identity.mime_type,
              sha256: identity.sha256,
              downloadUrl: signed.signedUrl,
              expiresIn: 300,
            },
            createdAt: nomination.created_at,
          };
        }
      }
      const { data: recoveryRow, error: recoveryError } = await admin
        .from('redemption_recovery_proposals')
        .select(
          'id,proposal_hash,evidence_digest,proposed_at,execute_after,required_approvals,approvals,state,transaction_hash,executed_at',
        )
        .eq('deployment_id', deployment.id)
        .eq('redemption_request_id', requestId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recoveryError) throw recoveryError;
      return json({
        request: {
          ...tracker(row, version, events as unknown as Array<Record<string, unknown>>),
          assignment,
          ...(owner &&
          row.authorization_payload &&
          row.authorization_signature &&
          row.authorization_authorizer &&
          row.authorization_expires_at
            ? {
                authorization: {
                  ...row.authorization_payload,
                  authorizer: row.authorization_authorizer,
                  signature: row.authorization_signature,
                },
              }
            : {}),
          ...(owner || adminView || custodianView
            ? { fulfillmentDestination: row.fulfillment_details }
            : bankView
              ? {
                  fulfillmentDestination: {
                    pickupLocation: row.fulfillment_details.pickupLocation ?? null,
                  },
                }
              : {}),
        },
        events,
        evidence: safeEvidence,
        capabilities: currentActions(row, owner, abstract),
        proxyNomination,
        recovery: recoveryRow
          ? {
              proposalId: recoveryRow.id,
              proposalHash: recoveryRow.proposal_hash,
              evidenceDigest: recoveryRow.evidence_digest,
              proposedAt: recoveryRow.proposed_at,
              executeAfter: recoveryRow.execute_after,
              requiredApprovals: Number(recoveryRow.required_approvals),
              approvals: Number(recoveryRow.approvals),
              state: recoveryRow.state,
              transactionHash: recoveryRow.transaction_hash,
              executedAt: recoveryRow.executed_at,
            }
          : null,
        legacyBaseline: projection?.legacy_baseline ?? false,
      });
    }

    if (action === 'resume_action_intent') {
      const requestedAction = String(body.intentAction ?? '');
      const allowed =
        (owner && ['nominate_proxy', 'cancel_redemption'].includes(requestedAction)) ||
        (abstract.has('custodian.fulfill') &&
          ['custodian_collect', 'record_arrival', 'release_owner_code'].includes(
            requestedAction,
          )) ||
        (abstract.has('redemption.approve') && requestedAction === 'release_owner_code') ||
        (abstract.has('redemption.recover') &&
          ['propose_recovery', 'approve_recovery', 'execute_recovery'].includes(requestedAction));
      if (!allowed) return json({ error: 'Not found' }, 404);
      if (['custodian_collect', 'record_arrival'].includes(requestedAction)) {
        const membership = membershipFor(memberships, 'custodian.fulfill', organizationId);
        if (!membership) return json({ error: 'Not found' }, 404);
        await requireAssignment(admin, deployment.id, requestId, 'custodian', membership);
      }
      const { data: intent, error } = await admin
        .from('redemption_action_intents')
        .select(
          'action,idempotency_key,expected_version,payload,chain_arguments,transaction_hash,created_at',
        )
        .eq('deployment_id', deployment.id)
        .eq('redemption_request_id', requestId)
        .eq('action', requestedAction)
        .is('completed_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!intent) return json({ pendingAction: null });
      return json({
        pendingAction: {
          action: intent.action,
          idempotencyKey: intent.idempotency_key,
          expectedVersion: Number(intent.expected_version),
          payload: intent.payload,
          chainArguments: intent.chain_arguments,
          transactionHash: intent.transaction_hash,
          createdAt: intent.created_at,
        },
      });
    }

    if (action === 'request_evidence_upload') {
      const category = String(body.category ?? '');
      const allowed =
        (owner && category === 'proxy_identity') ||
        (abstract.has('custodian.fulfill') &&
          ['custodian_collection', 'custodian_dispatch', 'redemption_arrival'].includes(
            category,
          )) ||
        (abstract.has('bank.receive') && category === 'bank_receipt') ||
        (abstract.has('admin.correct') &&
          ['admin_correction', 'recovery_evidence'].includes(category)) ||
        (abstract.has('bank.receive') && category === 'bank_handover');
      if (!allowed) return json({ error: 'Not found' }, 404);
      let uploadOrganizationId: string | null = null;
      if (['custodian_collection', 'custodian_dispatch', 'redemption_arrival'].includes(category)) {
        const membership = membershipFor(memberships, 'custodian.fulfill', organizationId);
        if (!membership) return json({ error: 'Not found' }, 404);
        await requireAssignment(admin, deployment.id, requestId, 'custodian', membership);
        uploadOrganizationId = membership.organizationId;
      } else if (['bank_receipt', 'bank_handover'].includes(category)) {
        const membership = membershipFor(memberships, 'bank.receive', organizationId);
        if (!membership) return json({ error: 'Not found' }, 404);
        await requireAssignment(admin, deployment.id, requestId, 'bank', membership);
        uploadOrganizationId = membership.organizationId;
      } else if (['admin_correction', 'recovery_evidence'].includes(category)) {
        const membership = membershipFor(memberships, 'admin.correct', organizationId);
        if (!membership) return json({ error: 'Not found' }, 404);
        uploadOrganizationId = membership.organizationId;
      }
      const mimeType = String(body.mimeType ?? '');
      const byteSize = Number(body.byteSize);
      const digest = String(body.sha256 ?? '').toLowerCase();
      if (
        !EVIDENCE_MIME.has(mimeType) ||
        !Number.isSafeInteger(byteSize) ||
        byteSize < 1 ||
        byteSize > 20 * 1024 * 1024 ||
        !/^[0-9a-f]{64}$/.test(digest)
      ) {
        return json({ error: 'Evidence metadata is invalid' }, 400);
      }
      const id = crypto.randomUUID();
      const fileName = safeFileName(body.fileName);
      const objectPath = `${deployment.id}/${requestId}/${id}`;
      const { error } = await admin.from('workflow_evidence').insert({
        id,
        deployment_id: deployment.id,
        workflow_kind: 'redemption',
        workflow_id: requestId,
        category,
        file_name: fileName,
        object_path: objectPath,
        mime_type: mimeType,
        byte_size: byteSize,
        sha256: digest,
        uploaded_by: user.id,
        uploaded_by_organization: uploadOrganizationId,
      });
      if (error) throw error;
      const { data: upload, error: uploadError } = await admin.storage
        .from('workflow-evidence')
        .createSignedUploadUrl(objectPath);
      if (uploadError) throw uploadError;
      return json(
        {
          evidence: { id, category, mimeType, byteSize, sha256: digest, state: 'pending' },
          upload: { bucket: 'workflow-evidence', path: objectPath, token: upload.token },
        },
        201,
      );
    }

    if (action === 'confirm_evidence_upload') {
      const evidenceId = requiredUuid(body.evidenceId, 'evidenceId');
      const { data: candidate, error } = await admin
        .from('workflow_evidence')
        .select('*')
        .eq('deployment_id', deployment.id)
        .eq('workflow_id', requestId)
        .eq('id', evidenceId)
        .eq('uploaded_by', user.id)
        .maybeSingle();
      if (error) throw error;
      if (!candidate) return json({ error: 'Evidence upload was not found' }, 404);
      const { data: blob, error: downloadError } = await admin.storage
        .from(candidate.bucket)
        .download(candidate.object_path);
      if (downloadError) throw new Error('Evidence upload is not complete');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const digest = await sha256(bytes);
      if (bytes.byteLength !== Number(candidate.byte_size) || digest !== candidate.sha256) {
        await admin.storage.from(candidate.bucket).remove([candidate.object_path]);
        throw new Error('Uploaded evidence does not match its declared digest');
      }
      const verifiedAt = new Date().toISOString();
      const { error: updateError } = await admin
        .from('workflow_evidence')
        .update({ verified_at: verifiedAt })
        .eq('id', candidate.id)
        .is('verified_at', null);
      if (updateError) throw updateError;
      return json({
        evidence: {
          id: candidate.id,
          category: candidate.category,
          mimeType: candidate.mime_type,
          byteSize: Number(candidate.byte_size),
          sha256: candidate.sha256,
          createdAt: candidate.created_at,
          state: 'verified',
        },
      });
    }

    if (action === 'prepare_proxy_nomination' || action === 'nominate_proxy') {
      if (!owner || !row.request_hash) return json({ error: 'Not found' }, 404);
      if (row.status !== 'onchain_requested') {
        return json({ error: 'Proxy nomination is closed for this redemption' }, 409);
      }
      const proxyName = String(body.proxyName ?? '').trim();
      const proxyWallet = String(body.proxyWallet ?? '');
      if (proxyName.length < 2 || proxyName.length > 200 || !isAddress(proxyWallet)) {
        return json({ error: 'Proxy name and wallet are required' }, 400);
      }
      const proof = await evidence(
        admin,
        deployment.id,
        requestId,
        requiredUuid(body.identityEvidenceId, 'identityEvidenceId'),
        'proxy_identity',
      );
      const nomination = proxyCollectorCommitment({
        deploymentId: deployment.id,
        requestId,
        requestHash: row.request_hash,
        ownerWallet: getAddress(row.requester_wallet),
        proxyName,
        proxyWallet: getAddress(proxyWallet),
        identityEvidenceSha256: proof.sha256,
      });
      if (action === 'prepare_proxy_nomination') {
        return json({
          nomination: { collectorCommitment: nomination.commitment, message: nomination.message },
        });
      }
      if (
        String(body.collectorCommitment ?? '').toLowerCase() !== nomination.commitment.toLowerCase()
      ) {
        return json({ error: 'Collector commitment does not match this nomination' }, 400);
      }
      const signature = String(body.ownerSignature ?? '') as Hash;
      if (
        !(await verifyMessage({
          address: getAddress(row.requester_wallet),
          message: nomination.message,
          signature,
        }))
      ) {
        return json({ error: 'Owner signature is invalid' }, 403);
      }
      const idempotencyKey = requiredUuid(body.idempotencyKey, 'idempotencyKey');
      const expectedVersion = requiredVersion(body.expectedVersion);
      const transactionHash = body.transactionHash ? requiredHash(body.transactionHash) : null;
      await storeIntent({
        admin,
        deploymentId: deployment.id,
        requestId,
        action,
        idempotencyKey,
        expectedVersion,
        payload: {
          proxyName,
          proxyWallet: getAddress(proxyWallet),
          evidenceId: proof.id,
          collectorCommitment: nomination.commitment,
        },
        chainArguments: {
          tokenId: String(row.token_id),
          collectorCommitment: nomination.commitment,
        },
      });
      const { error: nominationError } = await admin.from('redemption_proxy_nominations').upsert(
        {
          deployment_id: deployment.id,
          redemption_request_id: requestId,
          owner_profile_id: user.id,
          owner_wallet: row.requester_wallet.toLowerCase(),
          proxy_name: proxyName,
          proxy_wallet: proxyWallet.toLowerCase(),
          collector_commitment: nomination.commitment,
          identity_evidence_id: proof.id,
          owner_signature: signature,
          state: transactionHash ? 'approved' : 'pending',
          reviewed_by: transactionHash ? user.id : null,
          reviewed_at: transactionHash ? new Date().toISOString() : null,
        },
        { onConflict: 'deployment_id,redemption_request_id' },
      );
      if (nominationError) throw nominationError;
      if (!transactionHash) {
        return json({
          request: tracker(row, expectedVersion),
          chainAction: 'setCollectorCommitment',
          args: { tokenId: String(row.token_id), collectorCommitment: nomination.commitment },
        });
      }
      const chain = await receiptEvents(
        deployment,
        transactionHash,
        getAddress(row.requester_wallet),
      );
      const nominationEvent = findEvent(chain.logs, 'CollectorCommitmentSet');
      assertEventValue(nominationEvent.args.tokenId, String(row.token_id), 'token');
      assertEventValue(
        nominationEvent.args.collectorCommitment,
        nomination.commitment,
        'collector commitment',
      );
      row = await complete({
        admin,
        deploymentId: deployment.id,
        row,
        expectedVersion,
        expectedState: row.status,
        eventType: 'proxy_nominated',
        toState: row.status,
        userId: user.id,
        capability: 'owner',
        payload: {
          collectorCommitment: nomination.commitment,
          proxyWallet: proxyWallet.toLowerCase(),
        },
        transactionHash,
        idempotencyKey,
      });
      return json({ request: tracker(row, expectedVersion + 1) });
    }

    const idempotencyKey = requiredUuid(body.idempotencyKey, 'idempotencyKey');
    const expectedVersion = requiredVersion(body.expectedVersion);
    const { version } = await projectionVersion(admin, deployment.id, requestId);
    const isRecoveryReceipt =
      ['propose_recovery', 'approve_recovery', 'execute_recovery'].includes(action) &&
      Boolean(body.transactionHash);
    if (version !== expectedVersion && !isRecoveryReceipt)
      return json({ error: 'Workflow changed; reload before acting' }, 409);

    if (action === 'mark_onchain_requested') {
      if (!owner || row.status !== 'committed') return json({ error: 'Not found' }, 404);
      const transactionHash = requiredHash(body.transactionHash);
      await storeIntent({
        admin,
        deploymentId: deployment.id,
        requestId,
        action,
        idempotencyKey,
        expectedVersion,
        payload: {
          requestHash: row.request_hash,
          workflowIdHash: workflowIdHash(requestId),
          ownerWallet: row.requester_wallet,
        },
        chainArguments: {
          tokenId: String(row.token_id),
          requestHash: row.request_hash,
          workflowIdHash: workflowIdHash(requestId),
        },
      });
      const chain = await receiptEvents(
        deployment,
        transactionHash,
        getAddress(row.requester_wallet),
      );
      const opened = findEvent(chain.logs, 'RedemptionOpened');
      const bound = findEvent(chain.logs, 'RedemptionWorkflowBound');
      assertEventValue(opened.args.tokenId, String(row.token_id), 'token');
      assertEventValue(opened.args.gemId, String(row.gem_id), 'gem');
      assertEventValue(opened.args.owner, row.requester_wallet, 'owner');
      assertEventValue(opened.args.requestHash, row.request_hash ?? '', 'request hash');
      assertEventValue(bound.args.tokenId, String(row.token_id), 'workflow token');
      assertEventValue(bound.args.workflowIdHash, workflowIdHash(requestId), 'workflow hash');
      row = await complete({
        admin,
        deploymentId: deployment.id,
        row,
        expectedVersion,
        expectedState: 'committed',
        eventType: 'redemption_requested',
        toState: 'onchain_requested',
        userId: user.id,
        capability: 'owner',
        payload: { workflowIdHash: workflowIdHash(requestId) },
        transactionHash,
        idempotencyKey,
      });
      return json({ request: tracker(row, expectedVersion + 1) });
    }

    if (action === 'discard_redemption') {
      // A draft or committed request never reached the contract, or its
      // transaction is still unrecorded. Refuse while the chain shows this
      // workflow open: that request must be cancelled on-chain instead.
      if (!owner || !['draft', 'committed'].includes(row.status)) {
        return json({ error: 'Not found' }, 404);
      }
      const chain = serverChain(deployment);
      const record = await readRedemptionRecord(chain, manager(deployment), BigInt(row.token_id));
      if (
        record.phase !== ChainPhase.None &&
        record.workflowIdHash.toLowerCase() === workflowIdHash(requestId).toLowerCase()
      ) {
        return json(
          { error: 'This request is already open on-chain. Reload and cancel it instead.' },
          409,
        );
      }
      row = await complete({
        admin,
        deploymentId: deployment.id,
        row,
        expectedVersion,
        expectedState: row.status,
        eventType: 'redemption_discarded',
        toState: 'cancelled',
        userId: user.id,
        capability: 'owner',
        payload: {},
        idempotencyKey,
      });
      return json({ request: tracker(row, expectedVersion + 1) });
    }

    if (action === 'cancel_redemption') {
      if (!owner || !OWNER_CANCELLABLE_STATES.includes(row.status as RedemptionLifecycleState)) {
        return json({ error: 'Not found' }, 404);
      }
      const transactionHash = body.transactionHash ? requiredHash(body.transactionHash) : null;
      await storeIntent({
        admin,
        deploymentId: deployment.id,
        requestId,
        action,
        idempotencyKey,
        expectedVersion,
        payload: {},
        chainArguments: { tokenId: String(row.token_id) },
      });
      if (!transactionHash) {
        return json({
          request: tracker(row, expectedVersion),
          chainAction: 'cancelRedemption',
          args: { tokenId: String(row.token_id) },
        });
      }
      const chain = await receiptEvents(
        deployment,
        transactionHash,
        getAddress(row.requester_wallet),
      );
      const cancelled = findEvent(chain.logs, 'RedemptionCancelled');
      assertEventValue(cancelled.args.tokenId, String(row.token_id), 'token');
      assertEventValue(cancelled.args.gemId, String(row.gem_id), 'gem');
      row = await complete({
        admin,
        deploymentId: deployment.id,
        row,
        expectedVersion,
        expectedState: row.status,
        eventType: 'redemption_cancelled',
        toState: 'cancelled',
        userId: user.id,
        capability: 'owner',
        payload: {},
        transactionHash,
        idempotencyKey,
      });
      await admin
        .from('redemption_owner_codes')
        .update({ invalidated_at: new Date().toISOString() })
        .eq('deployment_id', deployment.id)
        .eq('redemption_request_id', requestId)
        .is('invalidated_at', null);
      return json({ request: tracker(row, expectedVersion + 1) });
    }

    if (action === 'accept_redemption') {
      // Step 1: Digital Carat accepts the on-chain request and names the vault
      // (a bank or storage vault) that holds the stone and will fulfil it.
      const membership = membershipFor(memberships, 'redemption.approve', organizationId);
      if (!membership) return json({ error: 'Not found' }, 404);
      assertRedemptionTransition(row.status as RedemptionLifecycleState, 'accepted');
      const vaultOrganizationId = requiredUuid(body.vaultOrganizationId, 'vaultOrganizationId');
      const { data: vault, error: vaultError } = await admin
        .from('verifier_organizations')
        .select('id,name,kind,active')
        .eq('id', vaultOrganizationId)
        .maybeSingle();
      if (vaultError) throw vaultError;
      if (!vault?.active || !['bank', 'custodian'].includes(vault.kind)) {
        return json({ error: 'Choose an active bank or custodian vault' }, 400);
      }
      const chain = serverChain(deployment);
      const record = await readRedemptionRecord(chain, manager(deployment), BigInt(row.token_id));
      if (
        record.phase !== ChainPhase.Requested ||
        record.workflowIdHash.toLowerCase() !== workflowIdHash(requestId).toLowerCase()
      ) {
        return json({ error: 'The on-chain request is not open for this workflow' }, 409);
      }
      const { data: existing, error: existingError } = await admin
        .from('redemption_workflow_assignments')
        .select('organization_id')
        .eq('deployment_id', deployment.id)
        .eq('redemption_request_id', requestId)
        .eq('assignment_role', 'custodian')
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing && existing.organization_id !== vaultOrganizationId) {
        return json({ error: 'A different vault is already assigned to this request' }, 409);
      }
      if (!existing) {
        const { error: assignError } = await admin.from('redemption_workflow_assignments').insert({
          deployment_id: deployment.id,
          redemption_request_id: requestId,
          assignment_role: 'custodian',
          organization_id: vaultOrganizationId,
          assigned_by: user.id,
        });
        if (assignError && assignError.code !== '23505') throw assignError;
      }
      row = await complete({
        admin,
        deploymentId: deployment.id,
        row,
        expectedVersion,
        expectedState: row.status,
        eventType: 'redemption_accepted',
        toState: 'accepted',
        userId: user.id,
        membership,
        capability: 'redemption.approve',
        payload: { vaultOrganizationId, vaultName: vault.name },
        idempotencyKey,
      });
      return json({ request: tracker(row, expectedVersion + 1) });
    }

    if (action === 'custodian_collect') {
      // Step 2: the vault confirms it has the request. The server, which is the
      // gem's on-chain custodian, starts fulfillment; vault staff sign nothing.
      const membership = membershipFor(memberships, 'custodian.fulfill', organizationId);
      if (!membership) return json({ error: 'Not found' }, 404);
      await requireAssignment(admin, deployment.id, requestId, 'custodian', membership);
      assertRedemptionTransition(row.status as RedemptionLifecycleState, 'custodian_collected');
      const payload = {
        note: String(body.note ?? '')
          .trim()
          .slice(0, 500),
      };
      await storeIntent({
        admin,
        deploymentId: deployment.id,
        requestId,
        action,
        idempotencyKey,
        expectedVersion,
        payload,
        chainArguments: { tokenId: String(row.token_id) },
      });
      const chain = serverChain(deployment);
      await assertOperatorIsCustodian(
        chain,
        getAddress(deployment.gem_registry_address),
        BigInt(row.gem_id),
      );
      const transactionHash = await runServerStep({
        admin,
        deployment,
        requestId,
        idempotencyKey,
        tokenId: BigInt(row.token_id),
        signer: chain,
        operator: chain,
        functionName: 'startFulfillment',
        args: [BigInt(row.token_id)],
        fromPhase: ChainPhase.Requested,
        expectedEvent: 'FulfillmentStarted',
      });
      row = await complete({
        admin,
        deploymentId: deployment.id,
        row,
        expectedVersion,
        expectedState: row.status,
        eventType: 'custodian_collected',
        toState: 'custodian_collected',
        userId: user.id,
        membership,
        capability: 'custodian.fulfill',
        payload,
        transactionHash,
        idempotencyKey,
      });
      return json({ request: tracker(row, expectedVersion + 1) });
    }

    if (action === 'custodian_dispatch') {
      // Step 3: the vault sends the stone to the pickup point or the holder.
      const membership = membershipFor(memberships, 'custodian.fulfill', organizationId);
      if (!membership) return json({ error: 'Not found' }, 404);
      await requireAssignment(admin, deployment.id, requestId, 'custodian', membership);
      assertRedemptionTransition(row.status as RedemptionLifecycleState, 'custodian_dispatched');
      const proof = await evidence(
        admin,
        deployment.id,
        requestId,
        requiredUuid(body.evidenceId, 'evidenceId'),
        'custodian_dispatch',
      );
      const payload = {
        evidenceId: proof.id,
        evidenceSha256: proof.sha256,
        dispatchedAt: requiredInstant(body.dispatchedAt, 'dispatchedAt'),
        carrier: String(body.carrier ?? '').trim() || null,
        trackingReference: String(body.trackingReference ?? '').trim() || null,
      };
      row = await complete({
        admin,
        deploymentId: deployment.id,
        row,
        expectedVersion,
        expectedState: 'custodian_collected',
        eventType: 'custodian_dispatched',
        toState: 'custodian_dispatched',
        userId: user.id,
        membership,
        capability: 'custodian.fulfill',
        payload,
        idempotencyKey,
      });
      return json({ request: tracker(row, expectedVersion + 1) });
    }

    if (action === 'record_arrival') {
      // Step 4: the stone is at the pickup point or in hand at the delivery
      // address. The arrival evidence becomes the on-chain fulfillment proof.
      const membership = membershipFor(memberships, 'custodian.fulfill', organizationId);
      if (!membership) return json({ error: 'Not found' }, 404);
      await requireAssignment(admin, deployment.id, requestId, 'custodian', membership);
      assertRedemptionTransition(row.status as RedemptionLifecycleState, 'arrived');
      const proof = await evidence(
        admin,
        deployment.id,
        requestId,
        requiredUuid(body.evidenceId, 'evidenceId'),
        'redemption_arrival',
      );
      const arrivedAt = requiredInstant(body.arrivedAt, 'arrivedAt');
      const location = String(body.location ?? '').trim();
      if (location.length < 2 || location.length > 300) {
        return json({ error: 'Arrival location is required' }, 400);
      }
      const chain = serverChain(deployment);
      const tokenId = BigInt(row.token_id);
      // A retry reuses the digest it committed to; the on-chain proof version
      // has already moved on if the first attempt's transaction landed.
      const prior = await loadIntent(admin, deployment.id, requestId, idempotencyKey);
      const proofVersion = prior
        ? Number((prior.payload as Record<string, unknown>).proofVersion)
        : Number((await readRedemptionRecord(chain, manager(deployment), tokenId)).proofVersion) +
          1;
      const proofDigest = keccak256(
        toBytes(
          canonicalize({
            schema: 'digital-carat-arrival-proof/v1',
            deploymentId: deployment.id,
            requestId,
            requestHash: row.request_hash,
            method: row.fulfillment_method,
            evidenceSha256: proof.sha256,
            arrivedAt,
            location,
            proofVersion,
          }),
        ),
      );
      const payload = {
        evidenceId: proof.id,
        evidenceSha256: proof.sha256,
        arrivedAt,
        location,
        proofDigest,
        proofVersion,
      };
      await storeIntent({
        admin,
        deploymentId: deployment.id,
        requestId,
        action,
        idempotencyKey,
        expectedVersion,
        payload,
        chainArguments: { tokenId: String(row.token_id), proofDigest },
      });
      await assertOperatorIsCustodian(
        chain,
        getAddress(deployment.gem_registry_address),
        BigInt(row.gem_id),
      );
      const transactionHash = await runServerStep({
        admin,
        deployment,
        requestId,
        idempotencyKey,
        tokenId,
        signer: chain,
        operator: chain,
        functionName: 'submitFulfillmentProof',
        args: [tokenId, proofDigest],
        fromPhase: ChainPhase.FulfillmentStarted,
        expectedEvent: 'FulfillmentProofSubmitted',
      });
      row = await complete({
        admin,
        deploymentId: deployment.id,
        row,
        expectedVersion,
        expectedState: row.status,
        eventType: 'arrival_recorded',
        toState: 'arrived',
        userId: user.id,
        membership,
        capability: 'custodian.fulfill',
        payload,
        transactionHash,
        idempotencyKey,
      });
      return json({ request: tracker(row, expectedVersion + 1) });
    }

    if (action === 'release_owner_code') {
      // The arrival proof is approved on-chain by the server and the holder is
      // emailed the code they enter to confirm the handover (step 5).
      const membership =
        membershipFor(memberships, 'custodian.fulfill', organizationId) ??
        membershipFor(memberships, 'redemption.approve', organizationId);
      if (!membership || !row.request_hash || !row.proof_digest || row.proof_version === null) {
        return json({ error: 'Not found' }, 404);
      }
      if (membership.capabilities.includes('custodian.fulfill')) {
        await requireAssignment(admin, deployment.id, requestId, 'custodian', membership);
      }
      assertRedemptionTransition(row.status as RedemptionLifecycleState, 'proof_approved');
      const operator = serverChain(deployment);
      const tokenId = BigInt(row.token_id);
      const record = await readRedemptionRecord(operator, manager(deployment), tokenId);
      if (record.proofDigest.toLowerCase() !== row.proof_digest.toLowerCase()) {
        throw new Error('The on-chain fulfillment proof does not match this workflow');
      }
      // Once approved on-chain, the chain's approval is the one the holder's
      // authorization must bind to, whoever triggered it.
      const binding =
        record.phase >= ChainPhase.ProofApproved
          ? { approvalId: record.approvalId, approvalVersion: record.approvalVersion }
          : approvalBinding({
              deploymentId: deployment.id,
              requestId,
              requestHash: row.request_hash,
              proofDigest: row.proof_digest,
              proofVersion: BigInt(row.proof_version),
              projectionVersion: expectedVersion,
              organizationId: membership.organizationId,
            });
      const authorizer = await configuredAuthorizer(deployment);
      const approver = await proofApproverChain(operator, manager(deployment), authorizer.address);
      const settings = await codeSettings(admin);
      const preparedIntent = await loadIntent(admin, deployment.id, requestId, idempotencyKey);
      const payload = {
        proofDigest: row.proof_digest,
        proofVersion: String(row.proof_version),
        approvalId: binding.approvalId,
        approvalVersion: binding.approvalVersion.toString(),
        recoveryEligibleAt: stableRecoveryEligibleAt(preparedIntent?.payload, settings.grace),
        approverWallet: approver.account.address,
      };
      await storeIntent({
        admin,
        deploymentId: deployment.id,
        requestId,
        action,
        idempotencyKey,
        expectedVersion,
        payload,
        chainArguments: {
          tokenId: String(row.token_id),
          approvalId: binding.approvalId,
          approvalVersion: binding.approvalVersion.toString(),
        },
      });
      const transactionHash = await runServerStep({
        admin,
        deployment,
        requestId,
        idempotencyKey,
        tokenId,
        signer: approver,
        operator,
        functionName: 'approveFulfillmentProof',
        args: [tokenId, binding.approvalId, binding.approvalVersion],
        fromPhase: ChainPhase.ProofSubmitted,
        expectedEvent: 'FulfillmentProofApproved',
      });
      row = await complete({
        admin,
        deploymentId: deployment.id,
        row,
        expectedVersion,
        expectedState: row.status,
        eventType: 'fulfillment_proof_approved',
        toState: 'proof_approved',
        userId: user.id,
        membership,
        capability: membership.capabilities.includes('custodian.fulfill')
          ? 'custodian.fulfill'
          : 'redemption.approve',
        payload,
        transactionHash,
        idempotencyKey,
      });
      let ownerCodeDelivery: {
        status: 'sent' | 'retry_required';
        expiresAt?: string;
        error?: string;
      };
      try {
        const delivered = await deliverOwnerCode(admin, deployment.id, row);
        ownerCodeDelivery = { status: 'sent', expiresAt: delivered.expiresAt };
      } catch (error) {
        ownerCodeDelivery = {
          status: 'retry_required',
          error: safeErrorMessage(error, 'Owner code delivery failed'),
        };
      }
      return json({ request: tracker(row, expectedVersion + 1), ownerCodeDelivery });
    }

    if (action === 'resend_owner_code') {
      if (!owner || !['proof_approved', 'owner_authorized'].includes(row.status))
        return json({ error: 'Not found' }, 404);
      const delivered = await deliverOwnerCode(admin, deployment.id, row, true);
      return json({
        request: tracker(row, expectedVersion),
        ownerCodeDelivery: { status: 'sent', expiresAt: delivered.expiresAt },
      });
    }

    if (['propose_recovery', 'approve_recovery', 'execute_recovery'].includes(action)) {
      const membership = membershipFor(memberships, 'redemption.recover', organizationId);
      if (!membership || !['proof_approved', 'owner_authorized'].includes(row.status)) {
        return json({ error: 'Not found' }, 404);
      }
      const recoveryWallet = await verifiedActingWallet(admin, user.id, body.recoveryWallet);
      await assertRecoveryApprover(deployment, recoveryWallet);
      const { data: activeProposal, error: proposalLookupError } = await admin
        .from('redemption_recovery_proposals')
        .select('*')
        .eq('deployment_id', deployment.id)
        .eq('redemption_request_id', requestId)
        .in('state', ['proposed', 'approved'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (proposalLookupError) throw proposalLookupError;

      if (action === 'propose_recovery') {
        if (activeProposal)
          return json({ error: 'An active recovery proposal already exists' }, 409);
        if (!row.request_hash || !row.proof_digest || !row.proof_approval_id) {
          return json({ error: 'Approved redemption binding is incomplete' }, 409);
        }
        const proof = await evidence(
          admin,
          deployment.id,
          requestId,
          requiredUuid(body.evidenceId, 'evidenceId'),
          'recovery_evidence',
        );
        const evidenceDigest = keccak256(
          toBytes(
            canonicalize({
              schema: 'digital-carat-recovery-evidence/v1',
              deploymentId: deployment.id,
              requestId,
              tokenId: String(row.token_id),
              owner: row.requester_wallet,
              requestHash: row.request_hash,
              workflowIdHash: workflowIdHash(requestId),
              proofDigest: row.proof_digest,
              proofVersion: String(row.proof_version),
              approvalId: row.proof_approval_id,
              approvalVersion: String(row.proof_approval_version),
              collectorCommitment: row.collector_commitment ?? zeroHash,
              evidenceSha256: proof.sha256,
            }),
          ),
        );
        const payload = {
          evidenceId: proof.id,
          evidenceSha256: proof.sha256,
          evidenceDigest,
          recoveryWallet,
        };
        const transactionHash = body.transactionHash ? requiredHash(body.transactionHash) : null;
        await storeIntent({
          admin,
          deploymentId: deployment.id,
          requestId,
          action,
          idempotencyKey,
          expectedVersion,
          payload,
          chainArguments: { tokenId: String(row.token_id), evidenceDigest },
        });
        if (!transactionHash) {
          return json({
            request: tracker(row, expectedVersion),
            chainAction: 'proposeRecovery',
            args: { tokenId: String(row.token_id), evidenceDigest },
          });
        }
        const chain = await receiptEvents(deployment, transactionHash, recoveryWallet);
        const proposed = findEvent(chain.logs, 'RecoveryProposed');
        const firstApproval = findEvent(chain.logs, 'RecoveryApproved');
        assertEventValue(proposed.args.tokenId, String(row.token_id), 'token');
        assertEventValue(proposed.args.evidenceDigest, evidenceDigest, 'recovery evidence');
        assertEventValue(proposed.args.proposer, recoveryWallet, 'recovery proposer');
        assertEventValue(firstApproval.args.tokenId, String(row.token_id), 'approval token');
        assertEventValue(
          firstApproval.args.proposalHash,
          proposed.args.proposalHash as string,
          'proposal hash',
        );
        assertEventValue(firstApproval.args.approver, recoveryWallet, 'first recovery approver');
        const chainProposal = await loadChainRecoveryProposal(
          getAddress(deployment.redemption_manager_address),
          BigInt(row.token_id),
        );
        assertEventValue(
          chainProposal.proposalHash,
          proposed.args.proposalHash as string,
          'stored proposal hash',
        );
        assertEventValue(chainProposal.evidenceDigest, evidenceDigest, 'stored recovery evidence');
        const proposalId = activeProposal?.id ?? crypto.randomUUID();
        const proposedAt = new Date(Number(chainProposal.proposedAt) * 1_000).toISOString();
        const executeAfter = new Date(Number(chainProposal.executeAfter) * 1_000).toISOString();
        const { data: recorded, error: recordError } = await admin.rpc('record_recovery_proposal', {
          p_deployment_id: deployment.id,
          p_request_id: requestId,
          p_proposal_id: proposalId,
          p_proposal_hash: proposed.args.proposalHash,
          p_evidence_digest: evidenceDigest,
          p_proposed_at: proposedAt,
          p_execute_after: executeAfter,
          p_required_approvals: Number(chainProposal.requiredApprovals),
          p_approvals: Number(chainProposal.approvals),
          p_actor_profile_id: user.id,
          p_actor_organization_id: membership.organizationId,
          p_actor_wallet: recoveryWallet,
          p_expected_version: expectedVersion,
          p_expected_state: row.status,
          p_transaction_hash: transactionHash,
          p_idempotency_key: idempotencyKey,
        });
        if (recordError) throw recordError;
        row = recorded as RedemptionRow;
        return json({
          request: tracker(row, expectedVersion + 1),
          recovery: {
            proposalId,
            proposalHash: proposed.args.proposalHash,
            evidenceDigest,
            executeAfter,
            requiredApprovals: Number(chainProposal.requiredApprovals),
            approvals: Number(chainProposal.approvals),
          },
        });
      }

      if (!activeProposal) return json({ error: 'Active recovery proposal not found' }, 404);
      if (action === 'approve_recovery') {
        if (activeProposal.proposed_by_wallet.toLowerCase() === recoveryWallet.toLowerCase()) {
          return json({ error: 'A second distinct recovery approver wallet is required' }, 409);
        }
        const { data: priorProfileApproval, error: priorProfileApprovalError } = await admin
          .from('redemption_recovery_approvals')
          .select('approver_wallet')
          .eq('proposal_id', activeProposal.id)
          .eq('approver_profile_id', user.id)
          .maybeSingle();
        if (priorProfileApprovalError) throw priorProfileApprovalError;
        if (
          priorProfileApproval &&
          priorProfileApproval.approver_wallet.toLowerCase() !== recoveryWallet.toLowerCase()
        ) {
          return json(
            { error: 'Recovery requires a second administrator with a distinct wallet' },
            409,
          );
        }
        const transactionHash = body.transactionHash ? requiredHash(body.transactionHash) : null;
        const payload = { proposalHash: activeProposal.proposal_hash, recoveryWallet };
        await storeIntent({
          admin,
          deploymentId: deployment.id,
          requestId,
          action,
          idempotencyKey,
          expectedVersion,
          payload,
          chainArguments: {
            tokenId: String(row.token_id),
            proposalHash: activeProposal.proposal_hash,
          },
        });
        if (!transactionHash) {
          return json({
            request: tracker(row, expectedVersion),
            chainAction: 'approveRecovery',
            args: { tokenId: String(row.token_id), proposalHash: activeProposal.proposal_hash },
          });
        }
        const chain = await receiptEvents(deployment, transactionHash, recoveryWallet);
        const approved = findEvent(chain.logs, 'RecoveryApproved');
        assertEventValue(approved.args.tokenId, String(row.token_id), 'token');
        assertEventValue(approved.args.proposalHash, activeProposal.proposal_hash, 'proposal hash');
        assertEventValue(approved.args.approver, recoveryWallet, 'recovery approver');
        const approvals = Number(approved.args.approvals);
        const { data: recorded, error: recordError } = await admin.rpc('record_recovery_approval', {
          p_deployment_id: deployment.id,
          p_request_id: requestId,
          p_proposal_hash: activeProposal.proposal_hash,
          p_approvals: approvals,
          p_actor_profile_id: user.id,
          p_actor_organization_id: membership.organizationId,
          p_actor_wallet: recoveryWallet,
          p_expected_version: expectedVersion,
          p_expected_state: row.status,
          p_transaction_hash: transactionHash,
          p_idempotency_key: idempotencyKey,
        });
        if (recordError) throw recordError;
        row = recorded as RedemptionRow;
        return json({
          request: tracker(row, expectedVersion + 1),
          recovery: { ...activeProposal, approvals },
        });
      }

      if (
        activeProposal.state !== 'approved' ||
        Number(activeProposal.approvals) < Number(activeProposal.required_approvals) ||
        Date.parse(activeProposal.execute_after) > Date.now()
      ) {
        return json(
          { error: 'Recovery is not approved or its seven-day grace is still active' },
          409,
        );
      }
      const transactionHash = body.transactionHash ? requiredHash(body.transactionHash) : null;
      const payload = { proposalHash: activeProposal.proposal_hash, recoveryWallet };
      await storeIntent({
        admin,
        deploymentId: deployment.id,
        requestId,
        action,
        idempotencyKey,
        expectedVersion,
        payload,
        chainArguments: {
          tokenId: String(row.token_id),
          proposalHash: activeProposal.proposal_hash,
        },
      });
      if (!transactionHash) {
        return json({
          request: tracker(row, expectedVersion),
          chainAction: 'executeRecovery',
          args: { tokenId: String(row.token_id), proposalHash: activeProposal.proposal_hash },
        });
      }
      const chain = await receiptEvents(deployment, transactionHash, recoveryWallet);
      const finalized = findEvent(chain.logs, 'RedemptionFinalized');
      assertEventValue(finalized.args.tokenId, String(row.token_id), 'token');
      assertEventValue(finalized.args.gemId, String(row.gem_id), 'gem');
      assertEventValue(finalized.args.owner, row.requester_wallet, 'owner');
      if (finalized.args.recovered !== true)
        throw new Error('Recovery transaction was not finalized as recovery');
      const executedAt = new Date().toISOString();
      const { data: recorded, error: recordError } = await admin.rpc('record_recovery_execution', {
        p_deployment_id: deployment.id,
        p_request_id: requestId,
        p_proposal_hash: activeProposal.proposal_hash,
        p_executed_at: executedAt,
        p_actor_profile_id: user.id,
        p_actor_organization_id: membership.organizationId,
        p_actor_wallet: recoveryWallet,
        p_expected_version: expectedVersion,
        p_expected_state: row.status,
        p_transaction_hash: transactionHash,
        p_idempotency_key: idempotencyKey,
      });
      if (recordError) throw recordError;
      row = recorded as RedemptionRow;
      return json({
        request: tracker(row, expectedVersion + 1),
        recovery: { ...activeProposal, state: 'executed', executedAt },
      });
    }

    if (action === 'prepare_owner_authorization' || action === 'authorize_owner') {
      if (
        !owner ||
        !['proof_approved', 'owner_authorized'].includes(row.status) ||
        !row.request_hash
      )
        return json({ error: 'Not found' }, 404);
      const ownerWallet = String(body.ownerWallet ?? '');
      if (
        !isAddress(ownerWallet) ||
        ownerWallet.toLowerCase() !== row.requester_wallet.toLowerCase()
      )
        return json({ error: 'Verified owner wallet required' }, 403);
      const { data: link } = await admin
        .from('wallet_links')
        .select('id')
        .eq('profile_id', user.id)
        .eq('wallet_address', ownerWallet.toLowerCase())
        .eq('is_primary', true)
        .not('verified_at', 'is', null)
        .maybeSingle();
      if (!link) return json({ error: 'Verified primary owner wallet required' }, 403);
      const currentOwner = await verifiedCurrentOwner(deployment, row);
      if (currentOwner.toLowerCase() !== ownerWallet.toLowerCase())
        return json({ error: 'Connected wallet is no longer the token owner' }, 409);
      const secret = Deno.env.get('REDEMPTION_CODE_SECRET')?.trim();
      if (!secret) throw new Error('Redemption owner authorization is not configured');
      const codeHash = await ownerCodeHash(secret, requestId, String(body.code ?? ''));
      const { data: validCode, error: codeError } = await admin.rpc(
        'verify_redemption_owner_code',
        {
          p_deployment_id: deployment.id,
          p_request_id: requestId,
          p_code_hash: codeHash,
          p_consume: false,
        },
      );
      if (codeError) throw codeError;
      if (!validCode)
        return json(
          { error: 'The authorization code is invalid, expired, or temporarily locked' },
          403,
        );

      if (action === 'prepare_owner_authorization') {
        const challengeId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
        const message = ownerAuthorizationChallenge({
          deploymentId: deployment.id,
          requestId,
          requestHash: row.request_hash,
          tokenId: String(row.token_id),
          ownerWallet: getAddress(ownerWallet),
          challengeId,
          expiresAt,
        });
        const { error } = await admin.from('redemption_authorization_challenges').insert({
          id: challengeId,
          deployment_id: deployment.id,
          redemption_request_id: requestId,
          owner_wallet: ownerWallet.toLowerCase(),
          message,
          expires_at: expiresAt,
        });
        if (error) throw error;
        return json({ challenge: { id: challengeId, message, expiresAt } });
      }

      const challengeId = requiredUuid(body.challengeId, 'challengeId');
      const { data: challenge, error: challengeError } = await admin
        .from('redemption_authorization_challenges')
        .select('*')
        .eq('deployment_id', deployment.id)
        .eq('redemption_request_id', requestId)
        .eq('id', challengeId)
        .eq('owner_wallet', ownerWallet.toLowerCase())
        .is('consumed_at', null)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (challengeError) throw challengeError;
      if (!challenge)
        return json({ error: 'Owner signature challenge expired; prepare another' }, 409);
      const ownerSignature = String(body.ownerSignature ?? '') as Hash;
      if (
        !(await verifyMessage({
          address: getAddress(ownerWallet),
          message: challenge.message,
          signature: ownerSignature,
        }))
      )
        return json({ error: 'Owner wallet signature is invalid' }, 403);
      if (
        !row.proof_digest ||
        row.proof_version === null ||
        !row.proof_approval_id ||
        row.proof_approval_version === null
      )
        throw new Error('Approved proof binding is incomplete');
      const account = await configuredAuthorizer(deployment);
      // RedemptionManager rejects an issuedAt later than block.timestamp, and the
      // wallet simulates against the latest block, which is always some seconds
      // old. Backdating keeps an immediate burn valid; the window stays within
      // MAX_AUTHORIZATION_LIFETIME (15 minutes) and still ends 13 minutes out.
      const issuedAt = BigInt(Math.floor(Date.now() / 1_000)) - AUTHORIZATION_BACKDATE_SECONDS;
      const deadline = issuedAt + 15n * 60n;
      const nonce = randomHex(32);
      const collectorCommitment = row.collector_commitment ?? zeroHash;
      const message = {
        tokenId: BigInt(row.token_id),
        owner: getAddress(ownerWallet),
        requestHash: row.request_hash,
        workflowIdHash: workflowIdHash(requestId),
        proofDigest: row.proof_digest,
        proofVersion: BigInt(row.proof_version),
        approvalId: row.proof_approval_id,
        approvalVersion: BigInt(row.proof_approval_version),
        collectorCommitment,
        nonce,
        issuedAt,
        deadline,
      };
      const signature = await account.signTypedData({
        domain: {
          name: 'DigitalCaratRedemption',
          version: '2',
          chainId: Number(deployment.chain_id),
          verifyingContract: getAddress(deployment.redemption_manager_address),
        },
        types: {
          RedemptionAuthorization: [
            { name: 'tokenId', type: 'uint256' },
            { name: 'owner', type: 'address' },
            { name: 'requestHash', type: 'bytes32' },
            { name: 'workflowIdHash', type: 'bytes32' },
            { name: 'proofDigest', type: 'bytes32' },
            { name: 'proofVersion', type: 'uint64' },
            { name: 'approvalId', type: 'bytes32' },
            { name: 'approvalVersion', type: 'uint64' },
            { name: 'collectorCommitment', type: 'bytes32' },
            { name: 'nonce', type: 'bytes32' },
            { name: 'issuedAt', type: 'uint64' },
            { name: 'deadline', type: 'uint64' },
          ],
        },
        primaryType: 'RedemptionAuthorization',
        message,
      });
      const serializedMessage = Object.fromEntries(
        Object.entries(message).map(([name, value]) => [
          name,
          typeof value === 'bigint' ? value.toString() : value,
        ]),
      );
      row = await complete({
        admin,
        deploymentId: deployment.id,
        row,
        expectedVersion,
        expectedState: row.status,
        eventType: 'owner_authorized',
        toState: 'owner_authorized',
        userId: user.id,
        capability: 'owner',
        payload: {
          authorizedWallet: ownerWallet.toLowerCase(),
          authorizationNonce: nonce,
          authorizationExpiresAt: new Date(Number(deadline) * 1_000).toISOString(),
          authorizationPayload: serializedMessage,
          authorizationSignature: signature,
          authorizationAuthorizer: account.address,
        },
        idempotencyKey,
      });
      const { data: consumed, error: consumeError } = await admin.rpc(
        'verify_redemption_owner_code',
        {
          p_deployment_id: deployment.id,
          p_request_id: requestId,
          p_code_hash: codeHash,
          p_consume: true,
        },
      );
      if (consumeError) throw consumeError;
      if (!consumed) throw new Error('Authorization code consumption failed after authorization');
      const { error: challengeConsumeError } = await admin
        .from('redemption_authorization_challenges')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', challengeId)
        .is('consumed_at', null);
      if (challengeConsumeError) throw challengeConsumeError;
      await audit(user.id, 'redemption.owner_authorized', 'redemption_request', requestId, {
        nonce,
        deadline: deadline.toString(),
      });
      return json({
        request: tracker(row, expectedVersion + 1),
        authorization: { ...serializedMessage, authorizer: account.address, signature },
      });
    }

    if (action === 'mark_chain_burned') {
      if (!owner || row.status !== 'owner_authorized') return json({ error: 'Not found' }, 404);
      const transactionHash = requiredHash(body.transactionHash);
      const chain = await receiptEvents(
        deployment,
        transactionHash,
        getAddress(row.requester_wallet),
      );
      const finalized = findEvent(chain.logs, 'RedemptionFinalized');
      assertEventValue(finalized.args.tokenId, String(row.token_id), 'token');
      assertEventValue(finalized.args.gemId, String(row.gem_id), 'gem');
      assertEventValue(finalized.args.owner, row.requester_wallet, 'owner');
      if (finalized.args.recovered !== false)
        throw new Error('Owner finalization was marked as recovery');
      row = await complete({
        admin,
        deploymentId: deployment.id,
        row,
        expectedVersion,
        expectedState: 'owner_authorized',
        eventType: 'chain_burned',
        toState: 'chain_burned',
        userId: user.id,
        capability: 'owner',
        payload: {},
        transactionHash,
        idempotencyKey,
      });
      return json({ request: tracker(row, expectedVersion + 1) });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    if (error instanceof OperatorBusyError) return json({ error: error.message }, 409);
    const message = safeErrorMessage(error, 'Redemption lifecycle operation failed');
    return json({ error: message }, /authorization|session/i.test(message) ? 401 : 400);
  }
});

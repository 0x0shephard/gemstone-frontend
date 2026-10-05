import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { json, preflight } from '../_shared/cors.ts';
import { requireProtocolDeployment } from '../_shared/deployment.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { MissingCapabilityError, operationalMembership } from '../_shared/operations.ts';
import { activateSellerSubmission } from '../_shared/sellerAutomation.ts';
import {
  appendWorkflowEvent,
  loadProjection,
  workflowTimeline,
} from '../_shared/workflowEvents.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown, label: string): string {
  const parsed = String(value ?? '');
  if (!UUID.test(parsed)) throw new Error(`${label} must be a UUID`);
  return parsed;
}

function version(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('expectedVersion is invalid');
  return parsed;
}

function eventView(event: Record<string, unknown>) {
  return {
    id: event.id,
    sequence: Number(event.sequence),
    type: event.event_type,
    fromState: event.from_state,
    toState: event.to_state,
    occurredAt: event.occurred_at,
    payload: event.payload ?? {},
    txHash: event.transaction_hash,
    supersedesEventId: event.supersedes_event_id,
    correctionReason: event.correction_reason,
  };
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
    const action = String(body.action ?? 'overview');
    const capability =
      action === 'correct' || action === 'assign_redemption' ? 'admin.correct' : 'admin.read';
    const membership = await operationalMembership(
      admin,
      user.id,
      capability,
      typeof body.organizationId === 'string' ? body.organizationId : undefined,
    );

    if (action === 'overview') {
      const { data: projections, error: projectionError } = await admin
        .from('workflow_projections')
        .select('*')
        .eq('deployment_id', deployment.id)
        .order('updated_at', { ascending: false })
        .limit(300);
      if (projectionError) throw projectionError;
      const sellerIds = (projections ?? [])
        .filter((item) => item.workflow_kind === 'seller')
        .map((item) => item.workflow_id);
      const redemptionIds = (projections ?? [])
        .filter((item) => item.workflow_kind === 'redemption')
        .map((item) => item.workflow_id);
      const { data: sellers, error: sellerError } = sellerIds.length
        ? await admin
            .from('seller_submissions')
            .select(
              'id,gem_name,carats,status,bank_location,bank_received_at,current_appraisal_id,' +
                'gem_appraisals!seller_submissions_current_appraisal_id_fkey(id,approved_valuation_usd,matrix_version,matrix_hash,created_at)',
            )
            .eq('deployment_id', deployment.id)
            .in('id', sellerIds)
        : { data: [], error: null };
      if (sellerError) throw sellerError;
      const { data: redemptions, error: redemptionError } = redemptionIds.length
        ? await admin
            .from('redemption_requests')
            .select(
              'id,token_id::text,fulfillment_method,status,request_hash,collector_commitment,proof_digest,' +
                'proof_version,proof_approval_id,proof_approval_version,proof_approved_at,recovery_eligible_at,' +
                'authorization_expires_at,updated_at,created_at',
            )
            .eq('deployment_id', deployment.id)
            .in('id', redemptionIds)
        : { data: [], error: null };
      if (redemptionError) throw redemptionError;
      const { data: matrices, error: matrixError } = await admin
        .from('valuation_matrix_versions')
        .select('id,version,state,matrix_hash,created_at,proposed_at,activated_at')
        .eq('deployment_id', deployment.id)
        .order('created_at', { ascending: false });
      if (matrixError) throw matrixError;
      const { data: organizations, error: organizationError } = await admin
        .from('verifier_organizations')
        .select('id,name,kind')
        .eq('active', true)
        .in('kind', ['custodian', 'bank'])
        .order('name');
      if (organizationError) throw organizationError;
      const { data: assignments, error: assignmentError } = redemptionIds.length
        ? await admin
            .from('redemption_workflow_assignments')
            .select('redemption_request_id,assignment_role,organization_id')
            .eq('deployment_id', deployment.id)
            .in('redemption_request_id', redemptionIds)
        : { data: [], error: null };
      if (assignmentError) throw assignmentError;
      const assignmentMap = new Map<
        string,
        { custodianOrganizationId?: string; bankOrganizationId?: string }
      >();
      for (const assignment of assignments ?? []) {
        const current = assignmentMap.get(assignment.redemption_request_id) ?? {};
        if (assignment.assignment_role === 'custodian') {
          current.custodianOrganizationId = assignment.organization_id;
        } else if (assignment.assignment_role === 'bank') {
          current.bankOrganizationId = assignment.organization_id;
        }
        assignmentMap.set(assignment.redemption_request_id, current);
      }
      const sellerMap = new Map((sellers ?? []).map((item) => [item.id, item]));
      const redemptionMap = new Map((redemptions ?? []).map((item) => [item.id, item]));
      return json({
        sellerWorkflows: await Promise.all(
          (projections ?? [])
            .filter((item) => item.workflow_kind === 'seller' && sellerMap.has(item.workflow_id))
            .map(async (projection) => {
              const seller = sellerMap.get(projection.workflow_id)!;
              const appraisal = seller.gem_appraisals as unknown as {
                id: string;
                approved_valuation_usd: string;
                matrix_version: string;
                matrix_hash: string;
                created_at: string;
              } | null;
              return {
                workflowId: seller.id,
                submissionId: seller.id,
                state: projection.current_state,
                version: Number(projection.version),
                legacyBaseline: projection.legacy_baseline,
                updatedAt: projection.updated_at,
                stoneName: seller.gem_name,
                declaredCarats: seller.carats,
                bankLocation: seller.bank_location,
                bankReceivedAt: seller.bank_received_at,
                appraisal: appraisal
                  ? {
                      appraisalId: appraisal.id,
                      approvedValuationUsd: String(appraisal.approved_valuation_usd),
                      matrixVersion: appraisal.matrix_version,
                      matrixHash: appraisal.matrix_hash,
                    }
                  : null,
                events: (await workflowTimeline(admin, deployment.id, 'seller', seller.id)).map(
                  (event) => eventView(event as Record<string, unknown>),
                ),
                nextActions:
                  projection.current_state === 'bank_received' ? ['start_seller_activation'] : [],
              };
            }),
        ),
        redemptionWorkflows: (projections ?? [])
          .filter(
            (item) => item.workflow_kind === 'redemption' && redemptionMap.has(item.workflow_id),
          )
          .map((projection) => {
            const redemption = redemptionMap.get(projection.workflow_id)!;
            return {
              id: redemption.id,
              tokenId: String(redemption.token_id),
              method: redemption.fulfillment_method,
              status: redemption.status,
              version: Number(projection.version),
              requestHash: redemption.request_hash,
              collectorCommitment: redemption.collector_commitment,
              proofDigest: redemption.proof_digest,
              proofVersion:
                redemption.proof_version === null ? null : Number(redemption.proof_version),
              proofApprovalId: redemption.proof_approval_id,
              proofApprovalVersion:
                redemption.proof_approval_version === null
                  ? null
                  : Number(redemption.proof_approval_version),
              proofApprovedAt: redemption.proof_approved_at,
              recoveryEligibleAt: redemption.recovery_eligible_at,
              authorizationExpiresAt: redemption.authorization_expires_at,
              updatedAt: redemption.updated_at,
              requestedAt: redemption.created_at,
              assignment: assignmentMap.get(redemption.id) ?? null,
              steps: [],
            };
          }),
        matrices: (matrices ?? []).map((matrix) => ({
          id: matrix.id,
          version: matrix.version,
          state: matrix.state,
          hash: matrix.matrix_hash,
          createdAt: matrix.created_at,
          proposedAt: matrix.proposed_at,
          activatedAt: matrix.activated_at,
        })),
        organizations: (organizations ?? []).map((organization) => ({
          id: organization.id,
          name: organization.name,
          kind: organization.kind,
        })),
      });
    }

    if (action === 'start_seller_activation') {
      await operationalMembership(admin, user.id, 'admin.read', membership.organizationId);
      const submissionId = uuid(body.submissionId, 'submissionId');
      const expectedVersion = version(body.expectedVersion);
      const idempotencyKey = uuid(body.idempotencyKey, 'idempotencyKey');
      const projection = await loadProjection(admin, deployment.id, 'seller', submissionId);
      if (
        !projection ||
        Number(projection.version) !== expectedVersion ||
        projection.current_state !== 'bank_received'
      ) {
        return json({ error: 'Bank receipt is required before activation' }, 409);
      }
      const { data: submission, error: lookupError } = await admin
        .from('seller_submissions')
        .select(
          'id,status,current_appraisal_id,bank_received_at,activation_tx_hash,onchain_gem_id,updated_at',
        )
        .eq('deployment_id', deployment.id)
        .eq('id', submissionId)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!submission?.current_appraisal_id || !submission.bank_received_at) {
        return json({ error: 'Immutable appraisal and bank receipt are required' }, 409);
      }
      const activation = await activateSellerSubmission(admin, submissionId, {
        allowAutomaticValuation: false,
      });
      const { data: activated, error: activatedError } = await admin
        .from('seller_submissions')
        .select('activation_tx_hash,updated_at')
        .eq('deployment_id', deployment.id)
        .eq('id', submissionId)
        .single();
      if (activatedError) throw activatedError;
      const event = await appendWorkflowEvent({
        admin,
        deploymentId: deployment.id,
        kind: 'seller',
        workflowId: submissionId,
        expectedVersion,
        expectedState: 'bank_received',
        eventType: 'seller_activated',
        toState: 'activated',
        actor: membership,
        capability: 'admin.read',
        payload: { onchainGemId: activation.onchainGemId?.toString() ?? null },
        transactionHash: activated.activation_tx_hash,
        idempotencyKey,
      });
      await audit(user.id, 'admin.seller_activated', 'seller_submission', submissionId, {
        organizationId: membership.organizationId,
        onchainGemId: activation.onchainGemId?.toString() ?? null,
      });
      return json({
        workflow: {
          workflowId: submissionId,
          submissionId,
          state: 'activated',
          version: expectedVersion + 1,
          legacyBaseline: projection.legacy_baseline,
          updatedAt: activated.updated_at,
          events: [eventView(event as Record<string, unknown>)],
          nextActions: [],
        },
        activation,
      });
    }

    if (action === 'assign_redemption') {
      const requestId = uuid(body.requestId, 'requestId');
      const expectedVersion = version(body.expectedVersion);
      const idempotencyKey = uuid(body.idempotencyKey, 'idempotencyKey');
      const custodianOrganizationId = uuid(body.custodianOrganizationId, 'custodianOrganizationId');
      const bankOrganizationId =
        body.bankOrganizationId === null || body.bankOrganizationId === undefined
          ? null
          : uuid(body.bankOrganizationId, 'bankOrganizationId');
      const { data: redemption, error: redemptionError } = await admin
        .from('redemption_requests')
        .select('id,status,fulfillment_method')
        .eq('deployment_id', deployment.id)
        .eq('id', requestId)
        .maybeSingle();
      if (redemptionError) throw redemptionError;
      if (!redemption) return json({ error: 'Redemption request not found' }, 404);
      if (redemption.fulfillment_method === 'pickup' && !bankOrganizationId) {
        return json({ error: 'Pickup redemptions require a bank assignment' }, 400);
      }
      const ids = [custodianOrganizationId, ...(bankOrganizationId ? [bankOrganizationId] : [])];
      const { data: organizations, error: organizationError } = await admin
        .from('verifier_organizations')
        .select('id,kind,active')
        .in('id', ids);
      if (organizationError) throw organizationError;
      const custodian = (organizations ?? []).find(
        (organization) =>
          organization.id === custodianOrganizationId &&
          organization.kind === 'custodian' &&
          organization.active,
      );
      const bank = bankOrganizationId
        ? (organizations ?? []).find(
            (organization) =>
              organization.id === bankOrganizationId &&
              organization.kind === 'bank' &&
              organization.active,
          )
        : null;
      if (!custodian || (bankOrganizationId && !bank)) {
        return json({ error: 'Active custodian/bank organizations are required' }, 400);
      }
      const projection = await loadProjection(admin, deployment.id, 'redemption', requestId);
      const currentVersion = projection ? Number(projection.version) : 0;
      if (currentVersion !== expectedVersion) {
        return json({ error: 'Workflow changed; reload before assigning' }, 409);
      }
      const { data: event, error: assignmentError } = await admin.rpc(
        'assign_redemption_workflow',
        {
          p_deployment_id: deployment.id,
          p_request_id: requestId,
          p_custodian_organization_id: custodianOrganizationId,
          p_bank_organization_id: bankOrganizationId,
          p_actor_profile_id: user.id,
          p_actor_organization_id: membership.organizationId,
          p_expected_version: expectedVersion,
          p_expected_state: projection?.current_state ?? redemption.status,
          p_idempotency_key: idempotencyKey,
        },
      );
      if (assignmentError) throw assignmentError;
      return json({
        assignment: { custodianOrganizationId, bankOrganizationId },
        event: eventView(event as Record<string, unknown>),
      });
    }

    if (action === 'correct') {
      const kind = String(body.workflowKind ?? '');
      if (kind !== 'seller' && kind !== 'redemption') {
        return json({ error: 'workflowKind must be seller or redemption' }, 400);
      }
      const workflowId = uuid(body.workflowId, 'workflowId');
      const expectedVersion = version(body.expectedVersion);
      const idempotencyKey = uuid(body.idempotencyKey, 'idempotencyKey');
      const supersedesEventId = uuid(body.supersedesEventId, 'supersedesEventId');
      const reason = String(body.reason ?? '').trim();
      if (reason.length < 10 || reason.length > 2_000) {
        return json({ error: 'Correction reason must be 10 to 2000 characters' }, 400);
      }
      const projection = await loadProjection(admin, deployment.id, kind, workflowId);
      if (!projection || Number(projection.version) !== expectedVersion) {
        return json({ error: 'Workflow changed; reload before correcting' }, 409);
      }
      // A correction visibly replaces inaccurate metadata; it never jumps the
      // operational state machine or bypasses a required physical/chain step.
      if (String(body.toState ?? '') !== projection.current_state) {
        return json({ error: 'Corrections cannot change workflow state' }, 400);
      }
      const { data: superseded, error: eventError } = await admin
        .from('workflow_events')
        .select('id')
        .eq('deployment_id', deployment.id)
        .eq('workflow_kind', kind)
        .eq('workflow_id', workflowId)
        .eq('id', supersedesEventId)
        .maybeSingle();
      if (eventError) throw eventError;
      if (!superseded) return json({ error: 'Superseded event was not found' }, 404);
      const event = await appendWorkflowEvent({
        admin,
        deploymentId: deployment.id,
        kind,
        workflowId,
        expectedVersion,
        expectedState: projection.current_state,
        eventType: 'admin_correction',
        toState: projection.current_state,
        actor: membership,
        capability: 'admin.correct',
        payload:
          body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
            ? (body.payload as Record<string, unknown>)
            : {},
        idempotencyKey,
        supersedesEventId,
        correctionReason: reason,
      });
      await audit(user.id, 'admin.workflow_corrected', `${kind}_workflow`, workflowId, {
        supersedesEventId,
        correctionEventId: (event as { id: string }).id,
        reason,
      });
      return json({
        workflow: {
          workflowId,
          state: projection.current_state,
          version: expectedVersion + 1,
          legacyBaseline: projection.legacy_baseline,
          updatedAt: (event as { occurred_at: string }).occurred_at,
          events: (await workflowTimeline(admin, deployment.id, kind, workflowId)).map((item) =>
            eventView(item as Record<string, unknown>),
          ),
        },
      });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    if (error instanceof MissingCapabilityError) return json({ error: 'Not found' }, 404);
    const message = safeErrorMessage(error, 'Admin operation failed');
    return json({ error: message }, /authorization|session/i.test(message) ? 401 : 400);
  }
});

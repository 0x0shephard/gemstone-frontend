import { custodyDatesProblem } from '../_shared/custodyDates.ts';
import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { json, preflight } from '../_shared/cors.ts';
import { requireProtocolDeployment } from '../_shared/deployment.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { MissingCapabilityError, operationalMembership } from '../_shared/operations.ts';
import { loadProjection, workflowTimeline } from '../_shared/workflowEvents.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function instant(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO date`);
  }
  return new Date(value).toISOString();
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
    const action = String(body.action ?? 'seller_queue');
    const membership = await operationalMembership(
      admin,
      user.id,
      'bank.receive',
      typeof body.organizationId === 'string' ? body.organizationId : undefined,
    );

    if (action === 'seller_queue') {
      const { data, error } = await admin
        .from('seller_submissions')
        .select(
          'id,gem_name,status,created_at,bank_received_at,bank_location,current_appraisal_id,' +
            'gem_appraisals!seller_submissions_current_appraisal_id_fkey(id,approved_valuation_usd,matrix_version,matrix_hash,created_at)',
        )
        .eq('deployment_id', deployment.id)
        .not('current_appraisal_id', 'is', null)
        .is('bank_received_at', null)
        .neq('status', 'withdrawn')
        .order('created_at')
        .limit(100);
      if (error) throw error;
      return json({
        queue: await Promise.all(
          (data ?? []).map(async (row) => {
            const appraisal = row.gem_appraisals as unknown as {
              id: string;
              approved_valuation_usd: string;
              matrix_version: string;
              matrix_hash: string;
              created_at: string;
            } | null;
            const projection = await loadProjection(admin, deployment.id, 'seller', row.id);
            return {
              submissionId: row.id,
              stoneName: row.gem_name,
              state: projection?.current_state ?? row.status,
              version: projection ? Number(projection.version) : 0,
              submittedAt: row.created_at,
              appraisal: appraisal
                ? {
                    appraisalId: appraisal.id,
                    approvedValuationUsd: String(appraisal.approved_valuation_usd),
                    matrixVersion: appraisal.matrix_version,
                    matrixHash: appraisal.matrix_hash,
                    createdAt: appraisal.created_at,
                  }
                : null,
            };
          }),
        ),
      });
    }

    if (action !== 'record_receipt') return json({ error: 'Unknown action' }, 400);
    const submissionId = String(body.submissionId ?? '');
    const idempotencyKey = String(body.idempotencyKey ?? '');
    const expectedVersion = Number(body.expectedVersion ?? 0);
    const location = String(body.location ?? '').trim();
    const notes = String(body.conditionNotes ?? '').trim();
    if (!UUID.test(submissionId) || !UUID.test(idempotencyKey)) {
      return json({ error: 'Valid submissionId and idempotencyKey are required' }, 400);
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      return json({ error: 'expectedVersion must be a non-negative integer' }, 400);
    }
    if (location.length < 3 || location.length > 300 || notes.length < 3 || notes.length > 2_000) {
      return json({ error: 'Location and condition notes are required' }, 400);
    }
    const receivedAt = instant(body.receivedAt, 'receivedAt');
    const custodyStartedAt = instant(body.custodyStartedAt, 'custodyStartedAt');
    const reserveEscrowEndsAt = instant(body.reserveEscrowEndsAt, 'reserveEscrowEndsAt');
    // Same rule as record_bank_receipt, but naming the date that breaks it.
    const datesProblem = custodyDatesProblem({
      receivedAt: new Date(receivedAt),
      custodyStartedAt: new Date(custodyStartedAt),
      agreementEndsAt: new Date(reserveEscrowEndsAt),
    });
    if (datesProblem) return json({ error: datesProblem }, 400);

    const { data: submission, error: lookupError } = await admin
      .from('seller_submissions')
      .select('id,status,current_appraisal_id,bank_received_at')
      .eq('deployment_id', deployment.id)
      .eq('id', submissionId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!submission) return json({ error: 'Submission not found' }, 404);
    if (submission.status === 'withdrawn') {
      return json({ error: 'The seller withdrew this submission' }, 409);
    }
    const projection = await loadProjection(admin, deployment.id, 'seller', submissionId);
    const currentVersion = projection ? Number(projection.version) : 0;
    const { data: priorEvent, error: priorEventError } = await admin
      .from('workflow_events')
      .select('id')
      .eq('deployment_id', deployment.id)
      .eq('workflow_kind', 'seller')
      .eq('workflow_id', submissionId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (priorEventError) throw priorEventError;
    if (!priorEvent && currentVersion !== expectedVersion) {
      return json({ error: 'Workflow changed; reload before acting' }, 409);
    }

    const { data: recorded, error } = await admin.rpc('record_bank_receipt', {
      p_deployment_id: deployment.id,
      p_submission_id: submissionId,
      p_organization_id: membership.organizationId,
      p_received_by: user.id,
      p_received_at: receivedAt,
      p_location: location,
      p_custody_started_at: custodyStartedAt,
      p_reserve_escrow_ends_at: reserveEscrowEndsAt,
      p_condition_notes: notes,
      p_matches_declared: body.matchesDeclared === true,
      p_expected_version: expectedVersion,
      p_expected_state: projection?.current_state ?? submission.status,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    if (!priorEvent) {
      await audit(user.id, 'bank.receipt_recorded', 'seller_submission', submissionId, {
        organizationId: membership.organizationId,
        receivedAt: recorded.bank_received_at,
        location: recorded.bank_location,
        custodyStartedAt: recorded.bank_custody_started_at,
        reserveEscrowEndsAt: recorded.reserve_escrow_ends_at,
        matchesDeclared: recorded.custody_matches_declared,
      });
    }
    const resultingProjection = await loadProjection(admin, deployment.id, 'seller', submissionId);
    return json({
      workflow: {
        workflowId: submissionId,
        submissionId,
        state: 'bank_received',
        version: resultingProjection ? Number(resultingProjection.version) : expectedVersion + 1,
        legacyBaseline: resultingProjection?.legacy_baseline ?? expectedVersion === 0,
        updatedAt: recorded.updated_at,
        stoneName: recorded.gem_name,
        bankLocation: recorded.bank_location,
        bankReceivedAt: recorded.bank_received_at,
        events: await workflowTimeline(admin, deployment.id, 'seller', submissionId),
        nextActions: ['start_seller_activation'],
      },
    });
  } catch (error) {
    if (error instanceof MissingCapabilityError) return json({ error: 'Not found' }, 404);
    const message = safeErrorMessage(error, 'Bank workflow failed');
    return json({ error: message }, /authorization|session/i.test(message) ? 401 : 400);
  }
});

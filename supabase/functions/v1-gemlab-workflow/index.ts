import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { json, preflight } from '../_shared/cors.ts';
import { currentDemand } from '../_shared/demand.ts';
import { requireProtocolDeployment } from '../_shared/deployment.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { MissingCapabilityError, operationalMembership } from '../_shared/operations.ts';
import { createGradedValuation } from '../_shared/valuation.ts';
import { type ValuationInput, ValuationError } from '../_shared/valuationMath.ts';
import { sameAppraisalIntent } from '../_shared/appraisalIntent.ts';
import { activeMatrix } from '../_shared/valuationMatrixRegistry.ts';
import { loadProjection, workflowTimeline } from '../_shared/workflowEvents.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = ['variety', 'clarity', 'treatment', 'shape', 'color', 'colorGrade'] as const;
const QUEUE_COLUMNS =
  'id,gem_name,carats,attributes,status,created_at,custody_received_at,custody_condition_notes,' +
  'custody_matches_declared,reserve_escrow_ends_at,current_appraisal_id,bank_received_at,bank_location';

function parseGrades(body: Record<string, unknown>): ValuationInput {
  const input = body.graded;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Graded attributes are required');
  }
  const source = input as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const field of FIELDS) {
    if (typeof source[field] !== 'string' || !source[field]!.trim()) {
      throw new Error(`Graded ${field} is required`);
    }
    values[field] = source[field]!.trim();
  }
  const caratWeight = Number(source.caratWeight);
  if (!Number.isFinite(caratWeight) || caratWeight <= 0) {
    throw new Error('Graded carat weight must be positive');
  }
  return { ...(values as Omit<ValuationInput, 'caratWeight'>), caratWeight };
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
    const membership = await operationalMembership(
      admin,
      user.id,
      action === 'appraise' || action === 'preview' ? 'gemlab.appraise' : 'gemlab.read',
      organizationId,
    );

    if (action === 'list') {
      const { data, error } = await admin
        .from('seller_submissions')
        .select(QUEUE_COLUMNS)
        .eq('deployment_id', deployment.id)
        .in('status', ['awaiting_custody', 'awaiting_grading'])
        .is('current_appraisal_id', null)
        .order('created_at')
        .limit(100);
      if (error) throw error;
      return json({
        queue: (data ?? []).map((row) => ({
          submissionId: row.id,
          stoneName: row.gem_name,
          carats: row.carats,
          submittedAt: row.created_at,
          state: row.status,
        })),
      });
    }

    const submissionId = String(body.submissionId ?? '');
    if (!UUID.test(submissionId)) return json({ error: 'Submission ID must be a UUID' }, 400);
    const { data: submission, error: submissionError } = await admin
      .from('seller_submissions')
      .select(QUEUE_COLUMNS)
      .eq('deployment_id', deployment.id)
      .eq('id', submissionId)
      .maybeSingle();
    if (submissionError) throw submissionError;
    if (!submission) return json({ error: 'Submission not found' }, 404);

    if (action === 'detail') {
      const { data: evidence, error } = await admin
        .from('evidence_files')
        .select('id,category,bucket,object_path,mime_type,byte_size,sha256,created_at')
        .eq('submission_id', submissionId)
        .order('created_at');
      if (error) throw error;
      const files = await Promise.all(
        (evidence ?? []).map(async (file) => {
          const { data: signed, error: signError } = await admin.storage
            .from(file.bucket)
            .createSignedUrl(file.object_path, 300);
          if (signError) throw signError;
          return {
            id: file.id,
            category: file.category,
            mimeType: file.mime_type,
            byteSize: file.byte_size,
            sha256: file.sha256,
            createdAt: file.created_at,
            eligibleAsPrimaryImage: file.category === 'gem_media',
            url: signed.signedUrl,
          };
        }),
      );
      const projection = await loadProjection(admin, deployment.id, 'seller', submissionId);
      const matrix = await activeMatrix(admin, deployment.id);
      const events = await workflowTimeline(admin, deployment.id, 'seller', submissionId);
      return json({
        submission: {
          submissionId: submission.id,
          stoneName: submission.gem_name,
          carats: submission.carats,
          submittedAt: submission.created_at,
          state: projection?.current_state ?? submission.status,
        },
        evidence: files.map((file) => ({
          ...file,
          fileName: file.id,
          downloadUrl: file.url,
        })),
        workflow: {
          workflowId: submission.id,
          submissionId: submission.id,
          state: projection?.current_state ?? submission.status,
          version: projection ? Number(projection.version) : 0,
          legacyBaseline: projection?.legacy_baseline ?? true,
          updatedAt: projection?.updated_at ?? submission.created_at,
          stoneName: submission.gem_name,
          declaredCarats: submission.carats,
          bankLocation: submission.bank_location,
          bankReceivedAt: submission.bank_received_at,
          events: events.map((event) => ({
            id: event.id,
            sequence: Number(event.sequence),
            type: event.event_type,
            fromState: event.from_state,
            toState: event.to_state,
            occurredAt: event.occurred_at,
            payload: event.payload,
            txHash: event.transaction_hash,
            supersedesEventId: event.supersedes_event_id,
            correctionReason: event.correction_reason,
          })),
          nextActions: submission.current_appraisal_id ? [] : ['appraise'],
        },
        currentAppraisal: null,
        matrix: {
          id: matrix.id ?? undefined,
          version: matrix.matrix.version,
          state: matrix.state,
          hash: matrix.hash,
          document: matrix.document,
        },
      });
    }

    if (!['preview', 'appraise'].includes(action)) return json({ error: 'Unknown action' }, 400);
    const graded = parseGrades(body);
    const primaryImageId = String(body.primaryImageId ?? '');
    if (!UUID.test(primaryImageId)) return json({ error: 'Primary image ID must be a UUID' }, 400);
    const { data: media, error: mediaError } = await admin
      .from('evidence_files')
      .select('id')
      .eq('id', primaryImageId)
      .eq('submission_id', submissionId)
      .eq('category', 'gem_media')
      .maybeSingle();
    if (mediaError) throw mediaError;
    if (!media)
      return json({ error: 'Primary image must be this submission’s gemstone media' }, 400);

    const idempotencyKey = String(body.idempotencyKey ?? '');
    const expectedVersion = Number(body.expectedVersion);
    if (
      action === 'appraise' &&
      (!UUID.test(idempotencyKey) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
    ) {
      return json({ error: 'Valid idempotencyKey and expectedVersion are required' }, 400);
    }
    if (action === 'appraise') {
      const { data: prior, error: priorError } = await admin
        .from('gem_appraisals')
        .select('*')
        .eq('deployment_id', deployment.id)
        .eq('submission_id', submissionId)
        .eq('client_request_id', idempotencyKey)
        .maybeSingle();
      if (priorError) throw priorError;
      if (prior) {
        if (
          !sameAppraisalIntent(prior, {
            organizationId: membership.organizationId,
            appraisedBy: user.id,
            primaryImageId,
            gradedInputs: graded,
          })
        ) {
          return json({ error: 'Idempotency key is bound to a different appraisal' }, 409);
        }
        const currentProjection = await loadProjection(
          admin,
          deployment.id,
          'seller',
          submissionId,
        );
        return json({
          appraisalId: prior.id,
          matrixVersion: prior.matrix_version,
          matrixHash: prior.matrix_hash,
          approvedValuationUsd: String(prior.approved_valuation_usd),
          breakdown: prior.breakdown,
          resumed: true,
          workflow: {
            workflowId: submissionId,
            submissionId,
            state: currentProjection?.current_state ?? 'appraised',
            version: currentProjection ? Number(currentProjection.version) : expectedVersion + 1,
            legacyBaseline: currentProjection?.legacy_baseline ?? expectedVersion === 0,
            updatedAt: currentProjection?.updated_at ?? prior.created_at,
            stoneName: submission.gem_name,
            declaredCarats: submission.carats,
            events: (await workflowTimeline(admin, deployment.id, 'seller', submissionId)).map(
              (event) => ({
                id: event.id,
                sequence: Number(event.sequence),
                type: event.event_type,
                fromState: event.from_state,
                toState: event.to_state,
                occurredAt: event.occurred_at,
                payload: event.payload,
                txHash: event.transaction_hash,
                supersedesEventId: event.supersedes_event_id,
                correctionReason: event.correction_reason,
              }),
            ),
            nextActions: ['record_bank_receipt'],
          },
        });
      }
    }
    if (submission.current_appraisal_id)
      return json({ error: 'Submission already appraised' }, 409);

    const matrix = await activeMatrix(admin, deployment.id);
    const demand = await currentDemand(admin);
    let valuation;
    try {
      valuation = createGradedValuation({
        submissionId,
        gradedBy: membership.organizationName,
        graded,
        demand,
        matrix: matrix.matrix,
      });
    } catch (error) {
      if (error instanceof ValuationError) return json({ error: error.message }, 422);
      throw error;
    }
    const response = {
      matrixVersion: matrix.matrix.version,
      matrixHash: matrix.hash,
      approvedValuationUsd: valuation.approvedValuationUsd.toString(),
      breakdown: valuation.breakdown,
    };
    if (action === 'preview') return json({ preview: true, ...response });

    const projection = await loadProjection(admin, deployment.id, 'seller', submissionId);
    if ((projection ? Number(projection.version) : 0) !== expectedVersion) {
      return json({ error: 'Workflow changed; reload before acting' }, 409);
    }
    const expectedState = projection?.current_state ?? submission.status;
    const { data: appraisal, error: recordError } = await admin.rpc('record_gem_appraisal', {
      p_deployment_id: deployment.id,
      p_submission_id: submissionId,
      p_organization_id: membership.organizationId,
      p_appraised_by: user.id,
      p_client_request_id: idempotencyKey,
      p_appraisal: {
        graded_inputs: graded,
        demand_snapshot: demand,
        breakdown: valuation.breakdown,
        approved_valuation_usd: valuation.approvedValuationUsd.toString(),
        matrix_version: matrix.matrix.version,
        matrix_hash: matrix.hash,
        matrix_document: matrix.document,
        valuation_hash: valuation.valuationHash,
        canonical_payload: valuation.canonicalPayload,
        nonce: valuation.nonce,
        primary_image_evidence_id: primaryImageId,
      },
      p_expected_version: expectedVersion,
      p_expected_state: expectedState,
    });
    if (recordError) throw recordError;
    await audit(user.id, 'gemlab.appraised', 'seller_submission', submissionId, {
      appraisalId: appraisal.id,
      matrixVersion: appraisal.matrix_version,
      matrixHash: appraisal.matrix_hash,
      organizationId: membership.organizationId,
    });
    const resultingProjection = await loadProjection(admin, deployment.id, 'seller', submissionId);
    return json({
      appraisalId: appraisal.id,
      matrixVersion: appraisal.matrix_version,
      matrixHash: appraisal.matrix_hash,
      approvedValuationUsd: String(appraisal.approved_valuation_usd),
      breakdown: appraisal.breakdown,
      workflow: {
        workflowId: submissionId,
        submissionId,
        state: 'appraised',
        version: resultingProjection ? Number(resultingProjection.version) : expectedVersion + 1,
        legacyBaseline: resultingProjection?.legacy_baseline ?? expectedVersion === 0,
        updatedAt: appraisal.created_at,
        stoneName: submission.gem_name,
        declaredCarats: submission.carats,
        events: (await workflowTimeline(admin, deployment.id, 'seller', submissionId)).map(
          (event) => ({
            id: event.id,
            sequence: Number(event.sequence),
            type: event.event_type,
            fromState: event.from_state,
            toState: event.to_state,
            occurredAt: event.occurred_at,
            payload: event.payload,
            txHash: event.transaction_hash,
            supersedesEventId: event.supersedes_event_id,
            correctionReason: event.correction_reason,
          }),
        ),
        nextActions: ['record_bank_receipt'],
      },
    });
  } catch (error) {
    if (error instanceof MissingCapabilityError) return json({ error: 'Not found' }, 404);
    const message = safeErrorMessage(error, 'Gemlab workflow failed');
    return json({ error: message }, /authorization|session/i.test(message) ? 401 : 400);
  }
});

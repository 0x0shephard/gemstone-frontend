import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { currentDemand } from '../_shared/demand.ts';
import { activateSellerSubmission } from '../_shared/sellerAutomation.ts';
import { createGradedValuation } from '../_shared/valuation.ts';
import { ValuationError, type ValuationInput } from '../_shared/valuationMath.ts';
import {
  assertWithinDailyLimit,
  NotAVerifierError,
  requireVerifier,
  ValuationLimitError,
} from '../_shared/verifier.ts';

/**
 * Records a lab's grading and prices the stone.
 *
 * `preview: true` computes and returns without writing anything, so the grader
 * sees the exact figure that will be committed, derived by the same code path.
 * A separate preview implementation could drift from the committing one.
 *
 * Committing fires the chain work immediately, per the single-approval decision.
 */

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const GRADE_FIELDS = ['variety', 'clarity', 'treatment', 'shape', 'color', 'colorGrade'] as const;

function parseGrades(body: Record<string, unknown>): ValuationInput {
  const graded = body.graded as Record<string, unknown> | undefined;
  if (!graded || typeof graded !== 'object') throw new Error('Graded attributes are required');

  const values: Record<string, string> = {};
  for (const field of GRADE_FIELDS) {
    const value = graded[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Graded ${field} is required`);
    }
    values[field] = value.trim();
  }

  const caratWeight = Number(graded.caratWeight);
  if (!Number.isFinite(caratWeight) || caratWeight <= 0) {
    throw new Error('Graded carat weight must be a positive number');
  }

  return { ...(values as Record<(typeof GRADE_FIELDS)[number], string>), caratWeight };
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const membership = await requireVerifier(admin, user.id);

    const body = (await request.json()) as Record<string, unknown>;
    const submissionId = String(body.submissionId ?? '');
    if (!uuidPattern.test(submissionId)) {
      return json({ error: 'Submission ID must be a UUID' }, 400);
    }
    const preview = body.preview === true;
    const graded = parseGrades(body);

    const { data: submission, error: submissionError } = await admin
      .from('seller_submissions')
      .select('id,status,graded_at,onchain_gem_id')
      .eq('id', submissionId)
      .maybeSingle();
    if (submissionError) throw submissionError;
    if (!submission) return json({ error: 'Submission not found' }, 404);
    if (!preview && submission.graded_at) {
      return json({ error: 'This submission has already been graded' }, 409);
    }

    // The snapshot is captured into the commitment, not re-read later: bid counts
    // move, and `valuationHash` promises the decision stays reproducible.
    const demand = await currentDemand(admin);

    let valuation;
    try {
      valuation = createGradedValuation({
        submissionId,
        gradedBy: membership.organizationName,
        graded,
        demand,
      });
    } catch (error) {
      // An unpriceable stone is a hard stop the grader must see, not a server
      // fault. The matrix refuses rather than guessing at a permanent figure.
      if (error instanceof ValuationError) return json({ error: error.message }, 422);
      throw error;
    }

    if (preview) {
      return json({
        preview: true,
        matrixVersion: valuation.matrixVersion,
        approvedValuationUsd: valuation.approvedValuationUsd.toString(),
        breakdown: valuation.breakdown,
      });
    }

    await assertWithinDailyLimit(admin, membership);

    const { error: updateError } = await admin
      .from('seller_submissions')
      .update({
        graded_attributes: graded,
        graded_by_organization: membership.organizationId,
        graded_by_profile: membership.profileId,
        graded_at: new Date().toISOString(),
        valuation_method: valuation.method,
        approved_valuation_usd: valuation.approvedValuationUsd.toString(),
        valuation_hash: valuation.valuationHash,
        valuation_matrix_hash: valuation.valuationMatrixHash,
        valuation_canonical_payload: valuation.canonicalPayload,
        valuation_nonce: valuation.nonce,
      })
      .eq('id', submissionId);
    if (updateError) throw updateError;

    const { data: record, error: recordError } = await admin
      .from('valuations')
      .insert({
        submission_id: submissionId,
        organization_id: membership.organizationId,
        graded_by: membership.profileId,
        matrix_version: valuation.matrixVersion,
        matrix_hash: valuation.valuationMatrixHash,
        graded_inputs: graded,
        demand_snapshot: demand,
        breakdown: valuation.breakdown,
        approved_valuation_usd: valuation.approvedValuationUsd.toString(),
        valuation_hash: valuation.valuationHash,
        canonical_payload: valuation.canonicalPayload,
        nonce: valuation.nonce,
      })
      .select('id')
      .single();
    if (recordError) throw recordError;

    await audit(membership.profileId, 'verification.graded', 'seller_submission', submissionId, {
      organization: membership.organizationName,
      matrixVersion: valuation.matrixVersion,
      approvedValuationUsd: valuation.approvedValuationUsd.toString(),
      graded,
    });

    // Activation consumes the valuation just written rather than computing its
    // own, and is resumable, so a partial run can be retried without registering
    // a second gem.
    const activation = await activateSellerSubmission(admin, submissionId);

    // The step-level hash rather than activation's latest, so the audit row points
    // at the transaction that actually recorded this valuation.
    const { data: activated } = await admin
      .from('seller_submissions')
      .select('valuation_tx_hash')
      .eq('id', submissionId)
      .maybeSingle();

    await admin
      .from('valuations')
      .update({
        gem_id: activation.onchainGemId ?? null,
        tx_hash: activated?.valuation_tx_hash ?? null,
      })
      .eq('id', record.id);

    return json({
      submissionId,
      matrixVersion: valuation.matrixVersion,
      approvedValuationUsd: valuation.approvedValuationUsd.toString(),
      breakdown: valuation.breakdown,
      activation,
    });
  } catch (error) {
    if (error instanceof NotAVerifierError) return json({ error: 'Not found' }, 404);
    if (error instanceof ValuationLimitError) return json({ error: error.message }, 429);
    const message = safeErrorMessage(error, 'Grading failed');
    const authorizationError = message === 'Missing authorization' || message === 'Invalid session';
    return json({ error: message }, authorizationError ? 401 : 400);
  }
});

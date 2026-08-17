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
 * Committing fires the chain work immediately, per the single-approval decision:
 * `registerGem`, `confirmCustody`, `verifyGem` at the graded figure, `listGem`,
 * and an auction where the seller chose one. None of that has run before this
 * point, so a rejection leaves nothing on-chain to unwind.
 */

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Statuses a grader may still act on. */
const GRADABLE_STATUSES = ['awaiting_grading'];

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
    const reject = body.action === 'reject';

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
    if (!preview && !GRADABLE_STATUSES.includes(submission.status)) {
      return json({ error: `A submission at "${submission.status}" cannot be graded` }, 409);
    }

    /*
     * Rejection is the counterpart to approval and deliberately writes nothing
     * on-chain and pins nothing. It is available only because grading now
     * precedes registration; once a gem exists on-chain there is no undo.
     */
    if (reject) {
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (reason.length < 10 || reason.length > 2_000) {
        return json({ error: 'A rejection reason of 10 to 2000 characters is required' }, 400);
      }
      const { data: rejected, error: rejectError } = await admin
        .from('seller_submissions')
        .update({
          status: 'rejected',
          verification_provider: membership.organizationName,
          rejection_reason: reason,
          rejected_by_organization: membership.organizationId,
          rejected_by_profile: membership.profileId,
          rejected_at: new Date().toISOString(),
        })
        .eq('id', submissionId)
        .in('status', GRADABLE_STATUSES)
        .select('id,status')
        .maybeSingle();
      if (rejectError) throw rejectError;
      if (!rejected) return json({ error: 'Submission changed while it was being rejected' }, 409);

      await audit(
        membership.profileId,
        'verification.rejected',
        'seller_submission',
        submissionId,
        {
          organization: membership.organizationName,
          reason,
        },
      );
      return json({ submissionId, status: 'rejected' });
    }

    const graded = parseGrades(body);

    /*
     * The image the grader promoted to the permanent NFT `image`. Validated
     * against this submission's own gemstone media: an id belonging to another
     * submission, or a certificate, must not become public.
     */
    let primaryImageId: string | undefined;
    if (body.primaryImageId !== undefined && body.primaryImageId !== null) {
      primaryImageId = String(body.primaryImageId);
      if (!uuidPattern.test(primaryImageId)) {
        return json({ error: 'Primary image ID must be a UUID' }, 400);
      }
      const { data: media, error: mediaError } = await admin
        .from('evidence_files')
        .select('id')
        .eq('id', primaryImageId)
        .eq('submission_id', submissionId)
        .eq('category', 'gem_media')
        .maybeSingle();
      if (mediaError) throw mediaError;
      if (!media) {
        return json({ error: 'The selected image is not gemstone media for this submission' }, 400);
      }
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

    /*
     * `approved` is what `prepareSellerSubmission` requires, and the status guard
     * makes this the point of no return: a concurrent second grader finds the row
     * no longer in `awaiting_grading` and is refused rather than writing a second
     * valuation over the first.
     */
    const { data: claimed, error: updateError } = await admin
      .from('seller_submissions')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        verification_provider: membership.organizationName,
        graded_attributes: graded,
        graded_by_organization: membership.organizationId,
        graded_by_profile: membership.profileId,
        graded_at: new Date().toISOString(),
        ...(primaryImageId ? { primary_image_evidence_id: primaryImageId } : {}),
        valuation_method: valuation.method,
        approved_valuation_usd: valuation.approvedValuationUsd.toString(),
        valuation_hash: valuation.valuationHash,
        valuation_matrix_hash: valuation.valuationMatrixHash,
        valuation_canonical_payload: valuation.canonicalPayload,
        valuation_nonce: valuation.nonce,
      })
      .eq('id', submissionId)
      .in('status', GRADABLE_STATUSES)
      .is('graded_at', null)
      .select('id')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!claimed) return json({ error: 'This submission was graded by someone else' }, 409);

    /*
     * The limit is enforced by the write itself, not by the check above it.
     *
     * `assertWithinDailyLimit` counts and returns, and the insert used to follow
     * as a separate round trip — so two graders in the same organisation could
     * both pass a check that said one remained, and both write. The limit exists
     * to bound what a compromised account can do in a day, which is precisely
     * the case where requests arrive at once. The earlier check is kept because
     * it fails fast with a clear message; this is what makes it true.
     */
    const { data: recordId, error: recordError } = await admin.rpc('record_valuation', {
      payload: {
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
      },
    });
    // DC001 is the limit being hit inside the lock — a real answer, not a fault.
    if (recordError?.code === 'DC001') {
      throw new ValuationLimitError(membership.dailyValuationLimit);
    }
    if (recordError) throw recordError;
    const record = { id: recordId as string };

    await audit(membership.profileId, 'verification.graded', 'seller_submission', submissionId, {
      organization: membership.organizationName,
      matrixVersion: valuation.matrixVersion,
      approvedValuationUsd: valuation.approvedValuationUsd.toString(),
      primaryImageId: primaryImageId ?? null,
      graded,
    });

    /*
     * Activation consumes the valuation just written rather than computing its
     * own — `allowAutomaticValuation` stays off so a bug that lost the graded
     * figure fails here instead of silently committing the test-only $500/ct
     * fallback to a field with no setter.
     *
     * It is resumable, so a chain failure is recoverable: the valuation row is
     * already durable and a retry picks up from the last completed step rather
     * than registering a second gem.
     */
    let activation;
    try {
      activation = await activateSellerSubmission(admin, submissionId, {
        allowAutomaticValuation: false,
      });
    } catch (error) {
      return json(
        {
          submissionId,
          matrixVersion: valuation.matrixVersion,
          approvedValuationUsd: valuation.approvedValuationUsd.toString(),
          breakdown: valuation.breakdown,
          activationState: 'failed',
          activationError: safeErrorMessage(error, 'On-chain activation failed'),
        },
        202,
      );
    }

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

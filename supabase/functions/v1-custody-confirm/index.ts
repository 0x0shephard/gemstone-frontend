import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import {
  canConfirmCustody,
  NotACustodianError,
  NotAVerifierError,
  requireVerifier,
} from '../_shared/verifier.ts';

/**
 * Records that a stone physically arrived, releasing it to the grading queue.
 *
 * Nothing here touches the chain. `GemRegistry.confirmCustody` is a mechanical
 * transition that has to stay inside the atomic activation sequence, because
 * `verifyGem` requires `CustodyConfirmed` and `registerGem` cannot run before
 * grading. This is the physical event that call attests to, and it must happen
 * first: a lab grading from the seller's photographs would defeat the whole
 * point of separating claimed attributes from graded ones.
 */

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const membership = await requireVerifier(admin, user.id);
    if (!canConfirmCustody(membership)) throw new NotACustodianError();

    const body = (await request.json()) as Record<string, unknown>;
    const submissionId = String(body.submissionId ?? '');
    if (!uuidPattern.test(submissionId)) {
      return json({ error: 'Submission ID must be a UUID' }, 400);
    }

    const notes = typeof body.conditionNotes === 'string' ? body.conditionNotes.trim() : '';
    if (notes.length > 2_000) {
      return json({ error: 'Condition notes must be 2000 characters or fewer' }, 400);
    }
    if (typeof body.matchesDeclared !== 'boolean') {
      return json({ error: 'Record whether the stone matches the declared attributes' }, 400);
    }
    /*
     * A divergence has to be described. "Does not match" with no explanation
     * tells the grader something is wrong but not what, which is worse than
     * silence because it invites them to guess.
     */
    if (!body.matchesDeclared && notes.length < 10) {
      return json(
        { error: 'Describe the divergence in the condition notes before confirming' },
        400,
      );
    }

    const { data: confirmed, error } = await admin
      .from('seller_submissions')
      .update({
        status: 'awaiting_grading',
        custody_received_at: new Date().toISOString(),
        custody_received_by: membership.profileId,
        custody_organization: membership.organizationId,
        custody_condition_notes: notes || null,
        custody_matches_declared: body.matchesDeclared,
      })
      .eq('id', submissionId)
      // Guarded so a second confirmation cannot overwrite the first intake
      // record, and so a stone already graded cannot be walked backwards.
      .eq('status', 'awaiting_custody')
      .is('custody_received_at', null)
      .select('id,status')
      .maybeSingle();
    if (error) throw error;
    if (!confirmed) {
      return json({ error: 'This submission is not awaiting custody intake' }, 409);
    }

    await audit(membership.profileId, 'custody.confirmed', 'seller_submission', submissionId, {
      organization: membership.organizationName,
      role: membership.role,
      matchesDeclared: body.matchesDeclared,
      conditionNotes: notes || null,
    });

    return json({ submissionId, status: 'awaiting_grading' });
  } catch (error) {
    if (error instanceof NotAVerifierError) return json({ error: 'Not found' }, 404);
    if (error instanceof NotACustodianError) return json({ error: error.message }, 403);
    const message = safeErrorMessage(error, 'Custody confirmation failed');
    const authorizationError = message === 'Missing authorization' || message === 'Invalid session';
    return json({ error: message }, authorizationError ? 401 : 400);
  }
});

import { adminClient, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { requireProtocolDeployment } from '../_shared/deployment.ts';
import { sellerActivationRefusal } from '../_shared/sellerOnboarding.ts';
import { loadProjection } from '../_shared/workflowEvents.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The seller's view of protocol activation.
 *
 * Activation is an administrator step: "Start protocol activation" runs it
 * after the bank receipt and records the `seller_activated` workflow event. This
 * endpoint used to run the same activation itself, so a seller's retry button
 * put the stone on-chain without that review and without the event, leaving
 * the operational timeline at `bank_received` with a live listing behind it.
 * It now only reports an activation the administrator has completed.
 */
Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const user = await requireUser(request);
    const { submissionId } = await request.json();
    if (typeof submissionId !== 'string' || !uuidPattern.test(submissionId)) {
      return json({ error: 'Submission ID must be a UUID' }, 400);
    }
    const admin = adminClient();
    const deployment = await requireProtocolDeployment(admin, request);
    const { data: submission, error: submissionError } = await admin
      .from('seller_submissions')
      .select(
        'id,status,activation_state,activation_error,onchain_gem_id::text,approved_valuation_usd::text,valuation_method,activation_tx_hash',
      )
      .eq('id', submissionId)
      .eq('deployment_id', deployment.id)
      .eq('seller_id', user.id)
      .maybeSingle();
    if (submissionError) throw submissionError;
    if (!submission) return json({ error: 'Submission not found' }, 404);
    const projection = await loadProjection(admin, deployment.id, 'seller', submissionId);
    const refusal = sellerActivationRefusal(projection?.current_state);
    if (refusal) return json({ error: refusal }, 409);
    return json({
      submissionId,
      status: submission.status,
      activationState: submission.activation_state,
      onchainGemId: submission.onchain_gem_id,
      approvedValuationUsd: submission.approved_valuation_usd,
      valuationMethod: submission.valuation_method,
      transactionHash: submission.activation_tx_hash,
    });
  } catch (error) {
    const message = safeErrorMessage(error, 'Seller activation lookup failed');
    const authorizationError = message === 'Missing authorization' || message === 'Invalid session';
    return json({ error: message }, authorizationError ? 401 : 409);
  }
});

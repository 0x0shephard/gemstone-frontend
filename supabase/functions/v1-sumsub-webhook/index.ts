import { adminClient, sha256 } from '../_shared/auth.ts';
import { json } from '../_shared/cors.ts';
import { parseSumsubEvent, signatureValid } from './review.ts';

/*
 * Sumsub applicant webhooks.
 *
 * The gateway JWT check is off for this function (supabase/config.toml): Sumsub
 * cannot send a Supabase token. The HMAC over the raw body is the only
 * authorization, so nothing is parsed or written before it verifies.
 *
 * Recording and applying are one transaction (`apply_sumsub_webhook_event`,
 * migration 202610300302). The earlier code read, updated, then recorded in
 * three round trips; now an event is either applied and recorded or neither,
 * and a failure returns 500 so Sumsub's retry policy redelivers it.
 *
 * Deliveries can arrive late, twice or out of order. The function applies an
 * event only if Sumsub created it no earlier than the last event applied for
 * that profile, so a delayed "pending" can no longer overwrite an approval.
 */
Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = Deno.env.get('SUMSUB_WEBHOOK_SECRET')?.trim();
  if (!secret) {
    // 503, not a crash: Sumsub keeps retrying, and the log says why.
    console.error('v1-sumsub-webhook: SUMSUB_WEBHOOK_SECRET is not set; refusing delivery');
    return json({ error: 'KYC webhook is not configured' }, 503);
  }

  const body = await request.text();
  const valid = await signatureValid(
    secret,
    body,
    request.headers.get('x-payload-digest'),
    request.headers.get('x-payload-digest-alg'),
  );
  if (!valid) return json({ error: 'Invalid webhook signature' }, 401);

  const parsed = parseSumsubEvent(body);
  if (!parsed.ok) {
    /*
     * Signed by Sumsub but unusable: an applicant created outside this app, or
     * a payload shape this code does not know. Acknowledged so it is not
     * retried forever, and logged so it is not invisible.
     */
    console.warn(`v1-sumsub-webhook: ignored signed event (${parsed.reason})`);
    return json({ ok: true, ignored: parsed.reason });
  }
  const { event } = parsed;
  const payloadSha256 = await sha256(body);

  /*
   * Keyed by the body digest. A redelivery is byte-identical (the signature is
   * over the body), so it collapses onto the first. The old key fell back to
   * `inspectionId`, which is the same for every event of an applicant, so the
   * first event without a correlation id swallowed all the later ones.
   */
  const { data: outcome, error } = await adminClient().rpc('apply_sumsub_webhook_event', {
    p_event_id: payloadSha256,
    p_event_type: event.type,
    p_payload_sha256: payloadSha256,
    p_correlation_id: event.correlationId,
    p_profile_id: event.profileId,
    p_applicant_id: event.applicantId,
    p_status: event.status,
    p_review_status: event.reviewStatus,
    p_review_result: event.reviewResult,
    p_level_name: event.levelName,
    p_event_created_at: event.createdAt.toISOString(),
  });
  if (error) {
    console.error('v1-sumsub-webhook: apply failed', error.message ?? error);
    return json({ error: 'KYC update failed' }, 500);
  }

  return json({ ok: true, outcome });
});

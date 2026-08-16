import { adminClient, sha256 } from '../_shared/auth.ts';
import { json } from '../_shared/cors.ts';

function equalHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function digest(secret: string, body: string, algorithm: string): Promise<string> {
  const hash = algorithm.toUpperCase().includes('512') ? 'SHA-512' : 'SHA-256';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash },
    false,
    ['sign'],
  );
  const value = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  const body = await request.text();
  const supplied = request.headers.get('x-payload-digest') ?? '';
  const algorithm = request.headers.get('x-payload-digest-alg') ?? 'HMAC_SHA256_HEX';
  const expected = await digest(Deno.env.get('SUMSUB_WEBHOOK_SECRET')!, body, algorithm);
  if (!equalHex(supplied.toLowerCase(), expected))
    return json({ error: 'Invalid webhook signature' }, 401);

  const payload = JSON.parse(body);
  const eventId = String(payload.correlationId ?? payload.inspectionId ?? (await sha256(body)));
  const admin = adminClient();

  /*
   * Checked, not claimed. Recording the event before applying it meant a failed
   * update was still acknowledged as handled: the function returned 200, Sumsub
   * stopped retrying, and the retry that would have fixed it was rejected as a
   * duplicate. A verification could be lost permanently with no error raised
   * anywhere — the applicant simply stayed unverified.
   *
   * Reading first leaves a window where two concurrent deliveries of the same
   * event both proceed. That is harmless: applying a review decision is
   * idempotent, and the row below rejects the loser. Losing a decision is not.
   */
  const { data: seen } = await admin
    .from('sumsub_webhook_events')
    .select('event_id')
    .eq('event_id', eventId)
    .maybeSingle();
  if (seen) return json({ ok: true, duplicate: true });

  const status =
    payload.reviewStatus === 'completed' && payload.reviewResult?.reviewAnswer === 'GREEN'
      ? 'approved'
      : payload.reviewStatus === 'completed'
        ? 'rejected'
        : 'pending';
  // The error was previously discarded, which is what made the loss silent.
  // Throwing produces a non-2xx, and Sumsub retries — which is the entire point
  // of a webhook having a retry policy.
  const { error: applyError } = await admin.from('kyc_profiles').upsert({
    profile_id: payload.externalUserId,
    applicant_id: payload.applicantId,
    status,
    review_result: payload.reviewResult ?? null,
    updated_at: new Date().toISOString(),
  });
  if (applyError) throw applyError;

  /*
   * Marked handled only now that it has been. A failure here costs a reprocess
   * of an idempotent update on the next delivery, which is the cheap direction
   * to fail in.
   */
  const { error: recordError } = await admin.from('sumsub_webhook_events').insert({
    event_id: eventId,
    event_type: payload.type,
    payload_sha256: await sha256(body),
  });
  if (recordError && recordError.code !== '23505') throw recordError;

  return json({ ok: true });
});

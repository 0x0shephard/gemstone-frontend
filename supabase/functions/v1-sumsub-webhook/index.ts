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
  const { error: duplicate } = await admin.from('sumsub_webhook_events').insert({
    event_id: eventId,
    event_type: payload.type,
    payload_sha256: await sha256(body),
  });
  if (duplicate?.code === '23505') return json({ ok: true, duplicate: true });
  if (duplicate) throw duplicate;

  const status =
    payload.reviewStatus === 'completed' && payload.reviewResult?.reviewAnswer === 'GREEN'
      ? 'approved'
      : payload.reviewStatus === 'completed'
        ? 'rejected'
        : 'pending';
  await admin.from('kyc_profiles').upsert({
    profile_id: payload.externalUserId,
    applicant_id: payload.applicantId,
    status,
    review_result: payload.reviewResult ?? null,
    updated_at: new Date().toISOString(),
  });
  return json({ ok: true });
});

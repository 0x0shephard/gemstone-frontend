import { adminClient, requireUser } from '../_shared/auth.ts';
import { json, preflight } from '../_shared/cors.ts';

const TOKEN_TTL_SECONDS = 600;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  const appToken = Deno.env.get('SUMSUB_APP_TOKEN')?.trim();
  const secret = Deno.env.get('SUMSUB_SECRET_KEY')?.trim();
  const levelName = Deno.env.get('SUMSUB_LEVEL_NAME')?.trim();
  if (!appToken || !secret || !levelName) {
    console.error(
      'v1-sumsub-token: SUMSUB_APP_TOKEN, SUMSUB_SECRET_KEY and SUMSUB_LEVEL_NAME must all be set',
    );
    return json({ error: 'Identity verification is not configured' }, 503);
  }

  let user;
  try {
    user = await requireUser(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid session' }, 401);
  }

  try {
    const path = '/resources/accessTokens/sdk';
    const body = JSON.stringify({ ttlInSecs: TOKEN_TTL_SECONDS, userId: user.id, levelName });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await hmacHex(secret, `${timestamp}POST${path}${body}`);
    const response = await fetch(`https://api.sumsub.com${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Token': appToken,
        'X-App-Access-Ts': timestamp,
        'X-App-Access-Sig': signature,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await response.json().catch(() => null)) as { token?: unknown } | null;
    if (!response.ok || typeof result?.token !== 'string') {
      console.error(`v1-sumsub-token: Sumsub returned ${response.status}`);
      return json({ error: 'KYC provider rejected token request' }, 502);
    }

    /*
     * The profile row exists from the first token on, so the page has a status
     * to show while Sumsub has not yet sent a webhook. Inserted, never
     * overwritten: the previous unconditional upsert reset an approved or
     * rejected applicant to `pending` every time the SDK was reopened. The
     * webhook owns the status from here.
     */
    const admin = adminClient();
    const { error: insertError } = await admin
      .from('kyc_profiles')
      .upsert(
        { profile_id: user.id, status: 'pending' },
        { onConflict: 'profile_id', ignoreDuplicates: true },
      );
    if (insertError) throw insertError;
    // A reset applicant reopening the SDK is back in progress.
    const { error: restartError } = await admin
      .from('kyc_profiles')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('profile_id', user.id)
      .eq('status', 'not_started');
    if (restartError) throw restartError;

    return json({ token: result.token, expiresIn: TOKEN_TTL_SECONDS });
  } catch (error) {
    // The previous code ignored the upsert result; a missing table or RLS error
    // returned a token for a profile with no status row.
    console.error('v1-sumsub-token: failed', error instanceof Error ? error.message : error);
    return json(
      { error: error instanceof Error ? error.message : 'KYC token failed' },
      error instanceof DOMException && error.name === 'TimeoutError' ? 504 : 500,
    );
  }
});

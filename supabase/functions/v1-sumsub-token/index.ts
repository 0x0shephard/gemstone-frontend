import { adminClient, requireUser } from '../_shared/auth.ts';
import { json, preflight } from '../_shared/cors.ts';

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
  try {
    const user = await requireUser(request);
    const appToken = Deno.env.get('SUMSUB_APP_TOKEN')!;
    const secret = Deno.env.get('SUMSUB_SECRET_KEY')!;
    const levelName = Deno.env.get('SUMSUB_LEVEL_NAME')!;
    const path = '/resources/accessTokens/sdk';
    const body = JSON.stringify({ ttlInSecs: 600, userId: user.id, levelName });
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
    });
    const result = await response.json();
    if (!response.ok) return json({ error: 'KYC provider rejected token request' }, 502);
    await adminClient().from('kyc_profiles').upsert({
      profile_id: user.id,
      status: 'pending',
      updated_at: new Date().toISOString(),
    });
    return json({ token: result.token, expiresIn: 600 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'KYC token failed' }, 400);
  }
});

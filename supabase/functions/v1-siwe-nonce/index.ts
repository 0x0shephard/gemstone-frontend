import { adminClient, requireUser, sha256 } from '../_shared/auth.ts';
import { json, preflight } from '../_shared/cors.ts';
import { resolveSiteOrigin } from '../_shared/origins.ts';

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const user = await requireUser(request);
    const { domain, uri, chainId } = await request.json();
    if (!resolveSiteOrigin(domain, uri)) {
      return json({ error: 'Domain or URI mismatch' }, 400);
    }
    if (Number(chainId) !== Number(Deno.env.get('CHAIN_ID') ?? 11155111)) {
      return json({ error: 'Unsupported chain' }, 400);
    }

    const nonce = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const { error } = await adminClient()
      .from('siwe_nonces')
      .insert({
        profile_id: user.id,
        nonce_hash: await sha256(nonce),
        domain,
        uri,
        chain_id: chainId,
        expires_at: expiresAt.toISOString(),
      });
    if (error) throw error;
    return json({ nonce, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Nonce issuance failed' }, 401);
  }
});

import { adminClient, requireUser, sha256 } from '../_shared/auth.ts';
import { configuredChainId } from '../_shared/authPolicy.ts';
import { json, preflight } from '../_shared/cors.ts';
import { resolveSiteOrigin } from '../_shared/origins.ts';

/** Raised by the `siwe_nonces_rate_limit` trigger (migration 202610300304). */
const RATE_LIMITED = 'siwe_nonce_rate_limited';

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  // Fail closed. Without CHAIN_ID there is no chain a signature can be bound to.
  const expectedChain = configuredChainId(Deno.env.get('CHAIN_ID'));
  if (expectedChain === null) {
    console.error('v1-siwe-nonce: CHAIN_ID is not set to a positive integer');
    return json({ error: 'Wallet linking is not configured' }, 503);
  }

  let user;
  try {
    user = await requireUser(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid session' }, 401);
  }

  try {
    const { domain, uri, chainId } = await request.json();
    if (!resolveSiteOrigin(domain, uri)) {
      return json({ error: 'Domain or URI mismatch' }, 400);
    }
    if (Number(chainId) !== expectedChain) {
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
        chain_id: expectedChain,
        expires_at: expiresAt.toISOString(),
      });
    if (error) {
      if (String(error.message ?? '').includes(RATE_LIMITED)) {
        return json({ error: 'Too many wallet-link attempts. Wait a few minutes and retry.' }, 429);
      }
      throw error;
    }
    return json({ nonce, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Nonce issuance failed' }, 400);
  }
});

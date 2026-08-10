import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { exchangeCode, storeConnection } from '../_shared/canva.ts';

/**
 * Completes the Canva handshake.
 *
 * The verifier is looked up server-side by `state` and deleted before the
 * exchange, so a code can be redeemed exactly once even if the callback URL is
 * reloaded or shared. The row also carries the profile it was issued for, which
 * is checked against the session — otherwise anyone who obtained a `state`
 * could bind their own Canva account to someone else's profile.
 */

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const body = (await request.json()) as Record<string, unknown>;

    const code = String(body.code ?? '').trim();
    const state = String(body.state ?? '').trim();
    if (!code || !state) return json({ error: 'Missing authorisation response' }, 400);

    /*
     * Deleted as it is read. A `delete … returning` is the atomic form of
     * "claim this once": two concurrent callbacks cannot both come away with
     * the verifier, and a replayed callback finds nothing.
     */
    const { data: pending, error } = await admin
      .from('canva_oauth_states')
      .delete()
      .eq('state', state)
      .select('profile_id,code_verifier,redirect_uri,expires_at')
      .maybeSingle();
    if (error) throw error;
    if (!pending) return json({ error: 'This authorisation link has already been used' }, 409);

    if (new Date(pending.expires_at as string).getTime() <= Date.now()) {
      return json({ error: 'The authorisation took too long. Try connecting again.' }, 409);
    }
    if (pending.profile_id !== user.id) {
      return json({ error: 'This authorisation belongs to a different account' }, 403);
    }

    const tokens = await exchangeCode(
      code,
      pending.code_verifier as string,
      pending.redirect_uri as string,
    );
    await storeConnection(user.id, tokens);
    await audit(user.id, 'canva.connected', 'profile', user.id, { scopes: tokens.scope });

    return json({ connected: true, scopes: tokens.scope });
  } catch (error) {
    return json({ error: safeErrorMessage(error, 'Could not connect Canva') }, 400);
  }
});

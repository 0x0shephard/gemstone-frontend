import { adminClient, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { canonicalSiteOrigin } from '../_shared/origins.ts';
import {
  CANVA_AUTHORIZE_URL,
  CANVA_SCOPES,
  CanvaNotConfiguredError,
  canvaConfigured,
  codeChallenge,
  randomVerifier,
} from '../_shared/canva.ts';

/**
 * Starts the Canva authorisation flow.
 *
 * Returns a URL rather than redirecting, so the caller controls when the user
 * leaves the page — they are usually mid-way through issuing a gift card, and
 * navigating out from under them would lose the claim code, which is displayed
 * once and never stored.
 */

/** Long enough to authorise, short enough that an abandoned flow expires. */
const STATE_TTL_MS = 10 * 60 * 1_000;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    if (!canvaConfigured()) throw new CanvaNotConfiguredError();
    const user = await requireUser(request);
    const admin = adminClient();

    // Fixed from configuration and registered with Canva. Accepting one from the
    // request would let a caller redirect the authorization code somewhere else.
    const redirectUri = `${canonicalSiteOrigin()}/canva/callback`;

    const verifier = randomVerifier();
    const state = crypto.randomUUID();

    const { error } = await admin.from('canva_oauth_states').insert({
      state,
      profile_id: user.id,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
    });
    if (error) throw error;

    // Housekeeping on the way past, so abandoned flows do not accumulate. No
    // scheduled job for a table whose rows are worthless after ten minutes.
    await admin.from('canva_oauth_states').delete().lt('expires_at', new Date().toISOString());

    /*
     * Built by hand rather than with `URLSearchParams`, which encodes a space as
     * `+`. That is legal `application/x-www-form-urlencoded`, but `scope` is a
     * space-delimited OAuth string and a server that percent-decodes without
     * form-decoding would read one nonsense scope with plus signs in it. Canva's
     * own example encodes the separators as `%20`, which is what
     * `encodeURIComponent` produces.
     */
    const query = Object.entries({
      code_challenge: await codeChallenge(verifier),
      // RFC 7636 registers this value as uppercase and every standard OAuth
      // client sends it that way. Canva's prose agrees — "must be set to S256" —
      // while its example URL shows lowercase, so the server is evidently
      // case-insensitive. If authorisation ever fails as an invalid request,
      // this is the first thing to try in lower case.
      code_challenge_method: 'S256',
      scope: CANVA_SCOPES,
      response_type: 'code',
      client_id: Deno.env.get('CANVA_CLIENT_ID')!.trim(),
      state,
      redirect_uri: redirectUri,
    })
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');

    return json({ authorizeUrl: `${CANVA_AUTHORIZE_URL}?${query}`, redirectUri });
  } catch (error) {
    if (error instanceof CanvaNotConfiguredError) {
      return json({ error: 'Canva is not configured for this deployment' }, 503);
    }
    return json({ error: safeErrorMessage(error, 'Could not start Canva authorisation') }, 400);
  }
});

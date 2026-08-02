import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import {
  setVerificationMode,
  verificationMode,
  VERIFICATION_MODE_KEY,
  type VerificationMode,
} from '../_shared/settings.ts';
import { NotAVerifierError, requireVerifier } from '../_shared/verifier.ts';

/**
 * Reads and changes which path new seller submissions take.
 *
 * Writing is restricted to an `org_admin` of an `admin`-kind organisation. A
 * grading lab must not be able to switch the protocol into a mode that bypasses
 * grading, and a seller has no path here at all: `protocol_settings` carries no
 * client write policy, so the only writer is this function on the service role.
 */

const MODES: VerificationMode[] = ['lab', 'auto'];

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const membership = await requireVerifier(admin, user.id);
    const canManage = membership.kind === 'admin' && membership.role === 'org_admin';

    const body = (await request.json().catch(() => ({}))) as { mode?: unknown };

    if (body.mode === undefined) {
      return json({
        verificationMode: await verificationMode(admin),
        canManageSettings: canManage,
        organization: membership.organizationName,
      });
    }

    if (!canManage) {
      return json({ error: 'Only a protocol administrator can change this setting' }, 403);
    }
    const mode = String(body.mode) as VerificationMode;
    if (!MODES.includes(mode)) {
      return json({ error: 'Verification mode must be lab or auto' }, 400);
    }

    const previous = await verificationMode(admin);
    await setVerificationMode(admin, mode, membership.profileId);

    /*
     * Worth a permanent record either way, but especially on the way to `auto`:
     * that mode prices stones with the test-only $500/ct rule and writes the
     * result to a field with no setter.
     */
    await audit(
      membership.profileId,
      'settings.verification_mode',
      'protocol_settings',
      VERIFICATION_MODE_KEY,
      {
        organization: membership.organizationName,
        from: previous,
        to: mode,
      },
    );

    return json({ verificationMode: mode, canManageSettings: true, previous });
  } catch (error) {
    if (error instanceof NotAVerifierError) return json({ error: 'Not found' }, 404);
    const message = safeErrorMessage(error, 'Settings unavailable');
    const authorizationError = message === 'Missing authorization' || message === 'Invalid session';
    return json({ error: message }, authorizationError ? 401 : 400);
  }
});

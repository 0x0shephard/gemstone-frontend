import { adminClient, requireUser } from '../_shared/auth.ts';
import { json, preflight } from '../_shared/cors.ts';
import { requireProtocolDeployment } from '../_shared/deployment.ts';
import { allOperationalMemberships } from '../_shared/operations.ts';
import { safeErrorMessage } from '../_shared/errors.ts';

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const user = await requireUser(request);
    const admin = adminClient();
    await requireProtocolDeployment(admin, request);
    const memberships = await allOperationalMemberships(admin, user.id);
    return json({
      memberships: memberships.map((membership) => ({
        organizationId: membership.organizationId,
        name: membership.organizationName,
        kind: membership.kind,
        role: membership.role,
        capabilities: membership.capabilities,
      })),
    });
  } catch (error) {
    const message = safeErrorMessage(error, 'Capabilities unavailable');
    return json({ error: message }, /authorization|session/i.test(message) ? 401 : 400);
  }
});

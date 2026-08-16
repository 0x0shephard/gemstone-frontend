import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { NotACustodianError, canConfirmCustody, requireVerifier } from '../_shared/verifier.ts';

/**
 * Delivery details for an open redemption, for the custodian who must fulfil it.
 *
 * `redemption_requests` is readable only by its requester, which is right for a
 * table holding someone's name and home address — but it left the custodian
 * unable to see where to send the stone while being the only party who can
 * confirm the handover and burn the token. An irreversible action was on screen
 * with the information needed to take it responsibly deliberately withheld.
 *
 * An endpoint rather than a second RLS policy, for two reasons. A policy would
 * expose every row to every verifier member, where this returns one request at a
 * time and only while it is genuinely open. And each read is written to the
 * audit trail: who looked at an address, and when, is worth being able to answer
 * later.
 */
Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const membership = await requireVerifier(admin, user.id);
    // The same gate as recording an intake. Receiving a stone and releasing one
    // are the two ends of custody, and neither is a grader's business.
    if (!canConfirmCustody(membership)) throw new NotACustodianError();

    const body = (await request.json()) as Record<string, unknown>;
    const tokenId = String(body.tokenId ?? '');
    if (!/^\d+$/.test(tokenId)) return json({ error: 'A numeric token id is required' }, 400);

    const { data: record, error } = await admin
      .from('redemption_requests')
      .select(
        'id,gem_id::text,token_id::text,fulfillment_method,fulfillment_details,status,created_at',
      )
      .eq('token_id', tokenId)
      /*
       * Only a live request. A cancelled or fulfilled one is finished business,
       * and its address should stop being readable when it stops being needed
       * rather than remaining available to anyone with a custody role forever.
       */
      .in('status', ['committed', 'onchain_requested'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!record) {
      return json({ error: 'No open redemption request for that token' }, 404);
    }

    await audit(
      membership.profileId,
      'redemption.fulfillment_viewed',
      'redemption_request',
      record.id as string,
      { tokenId },
    );

    return json({
      tokenId: record.token_id,
      gemId: record.gem_id,
      method: record.fulfillment_method,
      details: record.fulfillment_details,
      status: record.status,
      requestedAt: record.created_at,
    });
  } catch (error) {
    if (error instanceof NotACustodianError) return json({ error: error.message }, 403);
    return json({ error: safeErrorMessage(error, 'Could not read the redemption request') }, 400);
  }
});

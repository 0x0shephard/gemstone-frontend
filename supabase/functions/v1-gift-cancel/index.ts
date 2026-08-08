import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';

/**
 * Withdraws a card the sender issued.
 *
 * This is a database change only, and deliberately so. Cancelling stops the
 * card being claimable immediately, which is the urgent part — a printed card
 * that went to the wrong person is void the moment this returns. Clearing the
 * on-chain approval is a separate, unhurried step the sender takes from their
 * own wallet, because `approve` may only be called by the token's owner and
 * this function has no standing to call it.
 */

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const body = (await request.json()) as Record<string, unknown>;

    const giftId = String(body.giftId ?? '');
    if (!uuidPattern.test(giftId)) return json({ error: 'Gift card ID must be a UUID' }, 400);

    // Scoped by sender and by status in one statement: a card belonging to
    // someone else, or one already claimed, matches nothing and is reported the
    // same way rather than being distinguishable by the error.
    const { data: cancelled, error } = await admin
      .from('gift_cards')
      .update({ status: 'cancelled' })
      .eq('id', giftId)
      .eq('sender_id', user.id)
      .eq('status', 'active')
      .select('id,token_id::text')
      .maybeSingle();
    if (error) throw error;
    if (!cancelled) {
      return json({ error: 'That gift card is not active, or is not yours to cancel' }, 409);
    }

    await audit(user.id, 'gift.cancelled', 'gift_card', cancelled.id, {
      tokenId: cancelled.token_id,
    });

    return json({ giftId: cancelled.id, status: 'cancelled', tokenId: cancelled.token_id });
  } catch (error) {
    return json({ error: safeErrorMessage(error, 'Could not cancel the gift card') }, 400);
  }
});

import { adminClient, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { EmailNotConfiguredError, emailConfigured } from '../_shared/email.ts';
import { hashGiftCode, normalizeGiftCode } from '../_shared/gift.ts';
import { sendGiftInvitation } from '../_shared/giftInvitation.ts';

/**
 * Emails a gift card's claim link to its recipient.
 *
 * The code is not stored anywhere — only its hash — so it has to be handed back
 * in by the sender, who holds it for exactly as long as the issuing screen is
 * open. That constraint is a feature: this endpoint can deliver a card without
 * the database ever being able to.
 *
 * Separate from `v1-gift-create` on purpose. Issuing a card and posting it are
 * different decisions: the notes this was built from describe printing it just
 * as often as sending it, and a card that emails itself the instant it exists
 * takes that choice away.
 */

/** Enough to correct a typo or chase a recipient; not enough to harass one. */
const MAX_SENDS_PER_DAY = 5;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    if (!emailConfigured()) throw new EmailNotConfiguredError();

    const user = await requireUser(request);
    const admin = adminClient();
    const body = (await request.json()) as Record<string, unknown>;

    const code = normalizeGiftCode(body.code);
    if (!code) return json({ error: 'That gift code is not valid' }, 400);

    /*
     * Matched on the hash *and* on ownership. Holding the code alone must not be
     * enough to trigger mail — otherwise a recipient who received a card could
     * make the protocol send messages to the address printed on it.
     */
    const { data: card } = await admin
      .from('gift_cards')
      .select(
        'id,sender_id,token_id::text,gem_id::text,recipient_email,recipient_name,message,status,expires_at',
      )
      .eq('code_hash', await hashGiftCode(code))
      .maybeSingle();

    if (!card || card.sender_id !== user.id) {
      return json({ error: 'That gift card is not yours to send' }, 404);
    }
    if (card.status !== 'active') {
      return json({ error: 'This gift card is no longer active' }, 409);
    }
    if (new Date(card.expires_at as string).getTime() <= Date.now()) {
      return json({ error: 'This gift card has expired' }, 409);
    }

    // Counted from the audit trail rather than a column on the card, so the
    // limit needs no schema of its own and leaves the same record an operator
    // would want to read if a recipient ever complains.
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await admin
      .from('audit_records')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'gift_card')
      .eq('entity_id', card.id)
      .eq('action', 'gift.notified')
      .gte('created_at', since);
    if ((count ?? 0) >= MAX_SENDS_PER_DAY) {
      return json(
        { error: `This card has already been emailed ${MAX_SENDS_PER_DAY} times today` },
        429,
      );
    }

    const messageId = await sendGiftInvitation(
      admin,
      user.id,
      {
        id: card.id as string,
        token_id: card.token_id as string,
        recipient_email: card.recipient_email as string,
        recipient_name: (card.recipient_name as string | null) ?? null,
        message: (card.message as string | null) ?? null,
        expires_at: card.expires_at as string,
      },
      code,
    );

    return json({ sent: true, to: card.recipient_email, messageId });
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      return json(
        { error: 'Email delivery is not configured yet. Copy the link and send it yourself.' },
        503,
      );
    }
    return json({ error: safeErrorMessage(error, 'Could not send the gift card') }, 400);
  }
});

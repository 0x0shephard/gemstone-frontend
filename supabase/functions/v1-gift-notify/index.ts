import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { canonicalSiteOrigin } from '../_shared/origins.ts';
import {
  EmailNotConfiguredError,
  emailConfigured,
  escapeHtml,
  sendEmail,
} from '../_shared/email.ts';
import { formatGiftCode, hashGiftCode, normalizeGiftCode } from '../_shared/gift.ts';

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

    const { data: senderProfile } = await admin
      .from('profiles')
      .select('full_name,email')
      .eq('id', user.id)
      .maybeSingle();
    const senderName = (senderProfile?.full_name as string | null) ?? 'A Digital Carat collector';

    // Built from configuration, never from the request. This link is followed by
    // someone who trusts the sender, and a client-chosen origin would make it a
    // redirect the sender picked.
    const claimUrl = `${canonicalSiteOrigin()}/gift/${code}`;
    const displayCode = formatGiftCode(code);
    const expires = new Date(card.expires_at as string).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const greeting = card.recipient_name ? `Hello ${card.recipient_name},` : 'Hello,';
    const note = (card.message as string | null)?.trim();

    const text = [
      greeting,
      '',
      `${senderName} has sent you a gemstone on Digital Carat.`,
      ...(note ? ['', `"${note}"`] : []),
      '',
      `Claim it here: ${claimUrl}`,
      `Your code: ${displayCode}`,
      '',
      `Your gemstone is held in Digital Carat escrow. Create or sign in to your account with this email, then connect and verify a wallet to receive it. There is nothing to pay.`,
      `Claim by ${expires}.`,
    ].join('\n');

    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#14161a">
<div style="max-width:520px;margin:0 auto;background:#fffdf8;border:1px solid #e2dacb;border-radius:4px;padding:32px">
<p style="margin:0 0 24px;font-size:11px;letter-spacing:4px;color:#8a7550">DIGITAL CARAT</p>
<h1 style="margin:0 0 12px;font-size:22px;font-weight:600">${escapeHtml(greeting)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6">${escapeHtml(senderName)} has sent you a gemstone.</p>
${note ? `<p style="margin:0 0 20px;padding-left:14px;border-left:2px solid #8a7550;font-size:15px;line-height:1.6;font-style:italic;color:#4a4640">${escapeHtml(note)}</p>` : ''}
<p style="margin:0 0 28px"><a href="${escapeHtml(claimUrl)}" style="display:inline-block;background:#14161a;color:#fffdf8;text-decoration:none;padding:13px 26px;border-radius:4px;font-size:15px;font-weight:600">Claim your gemstone</a></p>
<p style="margin:0 0 6px;font-size:12px;color:#6b6455">Or enter this code at ${escapeHtml(canonicalSiteOrigin())}/gift</p>
<p style="margin:0 0 24px;font-family:ui-monospace,Menlo,monospace;font-size:18px;letter-spacing:2px;color:#8a7550">${escapeHtml(displayCode)}</p>
<p style="margin:0;padding-top:20px;border-top:1px solid #e2dacb;font-size:12px;line-height:1.6;color:#6b6455">Your gemstone is held in Digital Carat escrow. Create or sign in to your account with this email, then connect and verify a wallet to receive it. There is nothing to pay. Claim by ${escapeHtml(expires)}.</p>
</div></body></html>`;

    const messageId = await sendEmail({
      to: card.recipient_email as string,
      subject: `${senderName} sent you a gemstone`,
      html,
      text,
      // Replies belong to the person who sent the gift, not to the protocol.
      replyTo: (senderProfile?.email as string | null) ?? undefined,
    });

    await audit(user.id, 'gift.notified', 'gift_card', card.id as string, {
      tokenId: card.token_id,
      messageId,
    });

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

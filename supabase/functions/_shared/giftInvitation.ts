import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { audit } from './auth.ts';
import { canonicalSiteOrigin } from './origins.ts';
import { escapeHtml, sendEmail } from './email.ts';
import { formatGiftCode } from './gift.ts';

/**
 * The recipient's invitation to claim a gift card.
 *
 * Shared by activation (sent automatically as soon as custody is proven) and
 * v1-gift-notify (the sender's "Email again"). The code is not stored — only
 * its hash — so both callers pass the one the sender holds.
 */
export interface InvitationCard {
  id: string;
  token_id: string;
  recipient_email: string;
  recipient_name: string | null;
  message: string | null;
  expires_at: string;
}

export async function sendGiftInvitation(
  admin: SupabaseClient,
  senderId: string,
  card: InvitationCard,
  code: string,
): Promise<string> {
  const { data: senderProfile } = await admin
    .from('profiles')
    .select('full_name,email')
    .eq('id', senderId)
    .maybeSingle();
  const senderName = (senderProfile?.full_name as string | null) ?? 'A Digital Carat collector';

  // Built from configuration, never from the request. This link is followed by
  // someone who trusts the sender, and a client-chosen origin would make it a
  // redirect the sender picked.
  const claimUrl = `${canonicalSiteOrigin()}/gift/${code}`;
  const displayCode = formatGiftCode(code);
  const expires = new Date(card.expires_at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const greeting = card.recipient_name ? `Hello ${card.recipient_name},` : 'Hello,';
  const note = card.message?.trim();

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
    to: card.recipient_email,
    subject: `${senderName} sent you a gemstone`,
    html,
    text,
    // Replies belong to the person who sent the gift, not to the protocol.
    replyTo: (senderProfile?.email as string | null) ?? undefined,
  });
  await audit(senderId, 'gift.notified', 'gift_card', card.id, {
    tokenId: card.token_id,
    messageId,
  });
  return messageId;
}

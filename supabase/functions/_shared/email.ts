/**
 * Outbound transactional email.
 *
 * Deliberately a thin wrapper over one provider's HTTP API rather than raw SMTP:
 * Deno Deploy gives edge functions no outbound TCP, so SMTP is not available to
 * them at all. Supabase Auth's own mail (magic links, OTP) is configured
 * separately in project settings and does not come through here — this is only
 * for mail the application itself decides to send.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Where a reply should land — the sender of a gift, not the protocol. */
  replyTo?: string;
  /** Base64-encoded files, using Resend's in-memory attachment format. */
  attachments?: Array<{ filename: string; content: string }>;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email delivery is not configured');
    this.name = 'EmailNotConfiguredError';
  }
}

export function emailConfigured(): boolean {
  return Boolean(Deno.env.get('RESEND_API_KEY')?.trim() && Deno.env.get('MAIL_FROM')?.trim());
}

/**
 * Escapes text for interpolation into an HTML body.
 *
 * Every dynamic value in these messages is user-supplied — a recipient's name, a
 * sender's dedication — and goes into a document rendered by someone else's mail
 * client. Escaping is not optional.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendEmail(message: OutboundEmail): Promise<string> {
  const apiKey = Deno.env.get('RESEND_API_KEY')?.trim();
  const from = Deno.env.get('MAIL_FROM')?.trim();
  if (!apiKey || !from) throw new EmailNotConfiguredError();

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    }),
  });

  if (!response.ok) {
    /*
     * The provider's own message is the useful one here — "domain is not
     * verified" and "invalid API key" are both operator problems with different
     * fixes, and collapsing them into "email failed" makes the sender retry
     * something that will never work.
     */
    const detail = await response.text().catch(() => '');
    let reason = detail;
    try {
      reason = (JSON.parse(detail) as { message?: string }).message ?? detail;
    } catch {
      /* Not JSON; use the raw body. */
    }
    throw new Error(`Email delivery failed: ${reason || response.status}`);
  }

  const body = (await response.json()) as { id?: string };
  return body.id ?? '';
}

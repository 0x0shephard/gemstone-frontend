import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { canonicalSiteOrigin } from './origins.ts';
import { EmailNotConfiguredError, emailConfigured, escapeHtml, sendEmail } from './email.ts';

/**
 * Delivering a notification to whoever holds a wallet.
 *
 * Recording and sending are one step on purpose. The alternative — write rows,
 * mail them on a later pass — needs its own retry policy and its own way of not
 * double-sending, and the thing being built here exists precisely because
 * "someone will notice eventually" turned out to be false.
 */

export interface NotificationInput {
  /** Addressee. Case-insensitive; stored lowercase. */
  wallet: string;
  /** Stable slug, e.g. `offer.received`. Part of the deduplication key. */
  kind: string;
  title: string;
  /** Plain sentences. Rendered into both the email and the in-app feed. */
  body: string;
  /** Relative path where this is acted on, e.g. `/profile?tab=offers`. */
  actionPath?: string;
  entityType: string;
  entityId: string;
  /** When the thing being warned about lapses. */
  expiresAt?: Date;
  /** Label for the button in the email. Defaults to "Open Digital Carat". */
  actionLabel?: string;
}

export interface DeliveryResult {
  created: boolean;
  emailed: boolean;
  /** Why nothing was sent, when nothing was. */
  reason?: 'duplicate' | 'no-account' | 'no-email' | 'email-disabled' | 'send-failed';
}

/** Lowercased, or null when it is not an address at all. */
function normalizeWallet(wallet: string): string | null {
  const value = wallet.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(value) ? value : null;
}

/**
 * Records a notification and emails it if the wallet belongs to someone reachable.
 *
 * Idempotent by `(wallet, kind, entity_type, entity_id)`. A sweep that re-derives
 * the same open offer on every pass calls this every hour; only the first call
 * does anything. That guarantee lives in a unique index rather than in the
 * caller, so a crashed and rerun sweep cannot double-send either.
 */
export async function notifyWallet(
  admin: SupabaseClient,
  input: NotificationInput,
): Promise<DeliveryResult> {
  const wallet = normalizeWallet(input.wallet);
  if (!wallet) return { created: false, emailed: false, reason: 'no-account' };

  // A wallet nobody has linked still gets a row. When that person later signs in
  // and links it, `backfillProfileLinks` attaches the history rather than
  // starting them from empty.
  const { data: link } = await admin
    .from('wallet_links')
    .select('profile_id')
    .eq('wallet_address', wallet)
    .maybeSingle();
  const profileId = (link?.profile_id as string | null) ?? null;

  const { data: row, error } = await admin
    .from('notifications')
    .insert({
      wallet_address: wallet,
      profile_id: profileId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      action_path: input.actionPath ?? null,
      entity_type: input.entityType,
      entity_id: input.entityId,
      expires_at: input.expiresAt?.toISOString() ?? null,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    // 23505 is the unique index doing its job: already told them.
    if (error.code === '23505') return { created: false, emailed: false, reason: 'duplicate' };
    throw error;
  }
  if (!row) return { created: false, emailed: false, reason: 'duplicate' };

  if (!profileId) return { created: true, emailed: false, reason: 'no-account' };
  if (!emailConfigured()) return { created: true, emailed: false, reason: 'email-disabled' };

  const { data: profile } = await admin
    .from('profiles')
    .select('email,full_name')
    .eq('id', profileId)
    .maybeSingle();
  const to = (profile?.email as string | null)?.trim();
  if (!to) return { created: true, emailed: false, reason: 'no-email' };

  try {
    await sendEmail(
      renderNotification(input, (profile?.full_name as string | null) ?? null, to),
    );
  } catch (sendError) {
    if (sendError instanceof EmailNotConfiguredError) {
      return { created: true, emailed: false, reason: 'email-disabled' };
    }
    /*
     * The row stays, `emailed_at` stays null, and the sweep moves on. One
     * undeliverable address must not abort a pass that still has other people
     * to reach — and the notification is still there in the app.
     */
    return { created: true, emailed: false, reason: 'send-failed' };
  }

  await admin
    .from('notifications')
    .update({ emailed_at: new Date().toISOString() })
    .eq('id', row.id);

  return { created: true, emailed: true };
}

function renderNotification(
  input: NotificationInput,
  fullName: string | null,
  to: string,
): { to: string; subject: string; html: string; text: string } {
  const origin = canonicalSiteOrigin();
  const url = `${origin}${input.actionPath ?? '/profile'}`;
  const label = input.actionLabel ?? 'Open Digital Carat';
  const greeting = fullName ? `Hello ${fullName},` : 'Hello,';
  const deadline = input.expiresAt
    ? input.expiresAt.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      }) + ' UTC'
    : null;

  const text = [
    greeting,
    '',
    input.body,
    ...(deadline ? ['', `This expires at ${deadline}.`] : []),
    '',
    `${label}: ${url}`,
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#14161a">
<div style="max-width:520px;margin:0 auto;background:#fffdf8;border:1px solid #e2dacb;border-radius:4px;padding:32px">
<p style="margin:0 0 24px;font-size:11px;letter-spacing:4px;color:#8a7550">DIGITAL CARAT</p>
<h1 style="margin:0 0 12px;font-size:20px;font-weight:600">${escapeHtml(input.title)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6">${escapeHtml(input.body)}</p>
${deadline ? `<p style="margin:0 0 20px;font-size:14px;color:#8a5a2b">This expires at ${escapeHtml(deadline)}.</p>` : ''}
<p style="margin:0 0 28px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#14161a;color:#fffdf8;text-decoration:none;padding:13px 26px;border-radius:4px;font-size:15px;font-weight:600">${escapeHtml(label)}</a></p>
<p style="margin:0;padding-top:20px;border-top:1px solid #e2dacb;font-size:12px;line-height:1.6;color:#6b6455">You are receiving this because this wallet is linked to your Digital Carat account.</p>
</div></body></html>`;

  return { to, subject: input.title, html, text };
}

/**
 * Attaches past notifications to a profile that has just linked a wallet.
 *
 * Without this, someone who is emailed about an offer, then signs up to act on
 * it, arrives at an empty notification list — the rows exist, addressed to a
 * wallet that had no account when they were written.
 */
export async function backfillProfileLinks(
  admin: SupabaseClient,
  wallet: string,
  profileId: string,
): Promise<number> {
  const normalized = normalizeWallet(wallet);
  if (!normalized) return 0;
  const { data } = await admin
    .from('notifications')
    .update({ profile_id: profileId })
    .eq('wallet_address', normalized)
    .is('profile_id', null)
    .select('id');
  return data?.length ?? 0;
}

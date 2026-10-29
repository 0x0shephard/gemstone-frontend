import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { emailConfigured, escapeHtml, sendEmail } from './email.ts';
import { notifyWallet, type NotificationInput } from './notify.ts';
import { canonicalSiteOrigin } from './origins.ts';
import { staffProfilesFor, type StaffAlert, type StaffMemberRow } from './redemptionAlertPlan.ts';

/**
 * The bank that recorded the stone's arrival in the seller cycle, when it is an
 * active bank organization. Redemption sends the stone back out from there.
 */
export async function storageBank(
  admin: SupabaseClient,
  deploymentId: string,
  gemId: string | number,
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await admin
    .from('seller_submissions')
    .select('bank_organization_id,verifier_organizations!bank_organization_id(id,name,kind,active)')
    .eq('deployment_id', deploymentId)
    .eq('onchain_gem_id', String(gemId))
    .not('bank_organization_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const organization = (data as Record<string, unknown> | null)?.verifier_organizations as
    { id: string; name: string; kind: string; active: boolean } | null | undefined;
  return organization?.active && organization.kind === 'bank'
    ? { id: organization.id, name: organization.name }
    : null;
}

export interface StaffAlertResult {
  profiles: number;
  notified: number;
  emailed: number;
  failed: number;
}

function renderStaffEmail(alert: StaffAlert, fullName: string | null) {
  const url = `${canonicalSiteOrigin()}${alert.actionPath}`;
  const greeting = fullName ? `Hello ${fullName},` : 'Hello,';
  const text = [greeting, '', alert.body, '', `${alert.actionLabel}: ${url}`].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#14161a">
<div style="max-width:520px;margin:0 auto;background:#fffdf8;border:1px solid #e2dacb;border-radius:4px;padding:32px">
<p style="margin:0 0 24px;font-size:11px;letter-spacing:4px;color:#8a7550">DIGITAL CARAT</p>
<h1 style="margin:0 0 12px;font-size:20px;font-weight:600">${escapeHtml(alert.title)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6">${escapeHtml(alert.body)}</p>
<p style="margin:0 0 28px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#14161a;color:#fffdf8;text-decoration:none;padding:13px 26px;border-radius:4px;font-size:15px;font-weight:600">${escapeHtml(alert.actionLabel)}</a></p>
<p style="margin:0;padding-top:20px;border-top:1px solid #e2dacb;font-size:12px;line-height:1.6;color:#6b6455">You are receiving this because you are an operational member of an organization that handles Digital Carat redemptions.</p>
</div></body></html>`;
  return { subject: alert.title, text, html };
}

/**
 * Tells operational members that a redemption is waiting on them.
 *
 * In-app and push go through `notifyWallet` to each member's primary verified
 * wallet, deduplicated by the notifications index. Staff often have no wallet,
 * since they sign nothing, so each is also emailed at their account address;
 * the provider idempotency key makes a replayed sweep or retried action send
 * that email once.
 *
 * Best-effort throughout: an alert that cannot be delivered never fails the
 * sweep or the workflow step that triggered it.
 */
export async function deliverStaffAlerts(
  admin: SupabaseClient,
  input: {
    deploymentId: string;
    entityId: string;
    alerts: StaffAlert[];
    notify?: (notification: NotificationInput) => Promise<void>;
  },
): Promise<StaffAlertResult> {
  const result: StaffAlertResult = { profiles: 0, notified: 0, emailed: 0, failed: 0 };
  if (input.alerts.length === 0) return result;
  const notify =
    input.notify ??
    (async (notification: NotificationInput) => {
      await notifyWallet(admin, notification);
    });

  const { data: members, error } = await admin
    .from('verifier_members')
    .select('profile_id,organization_id,role,active,verifier_organizations(id,kind,active)')
    .eq('active', true);
  if (error) {
    result.failed += 1;
    return result;
  }
  const rows = (members ?? []) as unknown as StaffMemberRow[];
  const plan = input.alerts.map((alert) => ({
    alert,
    profiles: staffProfilesFor(rows, alert.audience),
  }));
  const profileIds = [...new Set(plan.flatMap((entry) => entry.profiles))];
  if (profileIds.length === 0) return result;
  result.profiles = profileIds.length;

  const [{ data: wallets }, { data: profiles }] = await Promise.all([
    admin
      .from('wallet_links')
      .select('profile_id,wallet_address')
      .in('profile_id', profileIds)
      .eq('is_primary', true)
      .not('verified_at', 'is', null),
    admin.from('profiles').select('id,email,full_name').in('id', profileIds),
  ]);
  const walletOf = new Map(
    (wallets ?? []).map((row) => [String(row.profile_id), String(row.wallet_address)]),
  );
  const profileOf = new Map(
    (profiles ?? []).map((row) => [
      String(row.id),
      {
        email: (row.email as string | null)?.trim() || null,
        fullName: (row.full_name as string | null) ?? null,
      },
    ]),
  );
  const canEmail = emailConfigured();

  for (const { alert, profiles: audience } of plan) {
    for (const profileId of audience) {
      const wallet = walletOf.get(profileId);
      if (wallet) {
        try {
          await notify({
            wallet,
            kind: alert.kind,
            title: alert.title,
            body: alert.body,
            actionPath: alert.actionPath,
            actionLabel: alert.actionLabel,
            entityType: 'redemption_request',
            entityId: input.entityId,
          });
          result.notified += 1;
        } catch {
          result.failed += 1;
        }
      }
      const profile = profileOf.get(profileId);
      if (!canEmail || !profile?.email) continue;
      try {
        await sendEmail({
          to: profile.email,
          ...renderStaffEmail(alert, profile.fullName),
          idempotencyKey: `redemption-staff/${input.deploymentId}/${alert.kind}/${input.entityId}/${profileId}`,
        });
        result.emailed += 1;
      } catch {
        result.failed += 1;
      }
    }
  }
  return result;
}

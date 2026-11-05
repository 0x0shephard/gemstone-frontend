import { parseEther } from 'npm:viem@2';
import { adminClient } from '../_shared/auth.ts';
import { json, preflight } from '../_shared/cors.ts';
import { operatorChain } from '../_shared/chain.ts';
import { protocolDeploymentId, requireProtocolDeployment } from '../_shared/deployment.ts';
import { emailConfigured, escapeHtml, sendEmail } from '../_shared/email.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import {
  freshnessReading,
  gasReading,
  shouldAlert,
  type HealthReading,
} from '../_shared/healthChecks.ts';

/**
 * Scheduled health check, run hourly by pg_cron (see
 * 202611050001_supabase_scheduler.sql).
 *
 * Replaces the chain-side half of the GitHub live canary, which stopped with
 * Actions: the operator's gas, and whether the sweeps are actually making
 * progress. A failing check emails the Digital Carat admins once, then again
 * only if it is still failing after REALERT_AFTER_HOURS.
 *
 * Authorised by a shared secret header, like the sweeps, and exempt from JWT
 * verification in supabase/config.toml.
 */

/** Demand ingest runs hourly; two missed runs is a problem. */
const DEMAND_MAX_AGE_MINUTES = 150;
/** The notification sweep runs every 15 minutes. */
const NOTIFY_MAX_AGE_MINUTES = 60;

type Admin = ReturnType<typeof adminClient>;

async function readings(admin: Admin, deploymentId: string, nowMs: number) {
  const results: HealthReading[] = [];

  try {
    const chain = operatorChain();
    const balance = await chain.publicClient.getBalance({ address: chain.account.address });
    const minimum = parseEther(Deno.env.get('OPERATOR_MIN_GAS_ETH')?.trim() || '0.0003');
    results.push(gasReading(chain.account.address, balance, minimum));
  } catch (error) {
    results.push({
      name: 'operator_gas',
      ok: false,
      detail: `Operator balance could not be read: ${safeErrorMessage(error, 'RPC error')}`,
    });
  }

  const { data: demand, error: demandError } = await admin
    .from('demand_scan_state')
    .select('updated_at')
    .eq('deployment_id', deploymentId)
    .maybeSingle();
  results.push(
    demandError
      ? {
          name: 'demand_sweep',
          ok: false,
          detail: `Demand cursor unreadable: ${demandError.message}`,
        }
      : freshnessReading(
          'demand_sweep',
          'Demand ingest',
          (demand?.updated_at as string | undefined) ?? null,
          nowMs,
          DEMAND_MAX_AGE_MINUTES,
        ),
  );

  const { data: notify, error: notifyError } = await admin
    .from('notification_scan_state')
    .select('updated_at')
    .eq('deployment_id', deploymentId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  results.push(
    notifyError
      ? {
          name: 'notify_sweep',
          ok: false,
          detail: `Notification cursor unreadable: ${notifyError.message}`,
        }
      : freshnessReading(
          'notify_sweep',
          'Notification sweep',
          (notify?.updated_at as string | undefined) ?? null,
          nowMs,
          NOTIFY_MAX_AGE_MINUTES,
        ),
  );

  return results;
}

/** Emails of active members of active admin organizations. */
async function adminEmails(admin: Admin): Promise<string[]> {
  const { data: members, error } = await admin
    .from('verifier_members')
    .select('profile_id,active,verifier_organizations(kind,active)')
    .eq('active', true);
  if (error) throw error;
  const profileIds = [
    ...new Set(
      (members ?? [])
        .filter((row) => {
          const organization = row.verifier_organizations as unknown as {
            kind: string;
            active: boolean;
          } | null;
          return organization?.kind === 'admin' && organization.active;
        })
        .map((row) => String(row.profile_id)),
    ),
  ];
  if (profileIds.length === 0) return [];
  const { data: profiles, error: profileError } = await admin
    .from('profiles')
    .select('email')
    .in('id', profileIds);
  if (profileError) throw profileError;
  return [
    ...new Set(
      (profiles ?? [])
        .map((row) => (row.email as string | null)?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email)),
    ),
  ];
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const expected = Deno.env.get('HEALTH_CHECK_SECRET')?.trim();
  if (!expected) return json({ error: 'Health check is not configured' }, 503);
  if (request.headers.get('x-health-check-secret') !== expected) {
    return json({ error: 'Forbidden' }, 403);
  }

  try {
    const admin = adminClient();
    await requireProtocolDeployment(admin);
    const deploymentId = protocolDeploymentId();
    const nowMs = Date.now();
    const results = await readings(admin, deploymentId, nowMs);

    const { data: previousRows, error: stateError } = await admin
      .from('health_alert_state')
      .select('check_name,failing,alerted_at');
    if (stateError) throw stateError;
    const previous = new Map((previousRows ?? []).map((row) => [String(row.check_name), row]));

    const toAlert = results.filter((reading) =>
      shouldAlert(reading, previous.get(reading.name) ?? null, nowMs),
    );

    let emailed = 0;
    let emailError: string | null = null;
    if (toAlert.length > 0 && emailConfigured()) {
      try {
        const recipients = await adminEmails(admin);
        const lines = toAlert.map((reading) => reading.detail);
        for (const to of recipients) {
          await sendEmail({
            to,
            subject: `Digital Carat health check: ${toAlert.length} problem${toAlert.length === 1 ? '' : 's'}`,
            text: `The hourly health check found:\n\n${lines.map((line) => `- ${line}`).join('\n')}\n`,
            html: `<p>The hourly health check found:</p><ul>${lines
              .map((line) => `<li>${escapeHtml(line)}</li>`)
              .join('')}</ul>`,
          });
          emailed += 1;
        }
      } catch (error) {
        emailError = safeErrorMessage(error, 'Alert email failed');
      }
    }

    const now = new Date(nowMs).toISOString();
    const alertedNames = new Set(emailed > 0 ? toAlert.map((reading) => reading.name) : []);
    const { error: upsertError } = await admin.from('health_alert_state').upsert(
      results.map((reading) => ({
        check_name: reading.name,
        failing: !reading.ok,
        detail: reading.detail,
        alerted_at: alertedNames.has(reading.name)
          ? now
          : reading.ok
            ? null
            : ((previous.get(reading.name)?.alerted_at as string | null | undefined) ?? null),
        updated_at: now,
      })),
      { onConflict: 'check_name' },
    );
    if (upsertError) throw upsertError;

    return json({
      ok: results.every((reading) => reading.ok),
      checks: results,
      alerted: [...alertedNames],
      emailed,
      ...(emailError ? { emailError } : {}),
    });
  } catch (error) {
    return json({ error: safeErrorMessage(error, 'Health check failed') }, 500);
  }
});

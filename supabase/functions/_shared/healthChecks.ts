/**
 * Decisions for the scheduled health check (v1-health-check).
 *
 * Pure, so the thresholds and the alert cadence are tested without a chain or a
 * database. The function gathers the readings; this module says what they mean.
 */

export interface HealthReading {
  name: string;
  ok: boolean;
  detail: string;
}

/** Wei, as a decimal ETH string with up to six decimals, for alert text. */
export function formatEth(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function gasReading(wallet: string, balanceWei: bigint, minimumWei: bigint): HealthReading {
  const ok = balanceWei >= minimumWei;
  return {
    name: 'operator_gas',
    ok,
    detail: ok
      ? `${wallet} holds ${formatEth(balanceWei)} ETH`
      : `${wallet} holds ${formatEth(balanceWei)} ETH, below the ${formatEth(minimumWei)} ETH minimum. Top it up: it pays for activations, seller mints and auction settlement.`,
  };
}

/**
 * Whether a sweep has made progress recently. `lastProgressAt` is the newest
 * cursor commit; null means the sweep has never committed for this deployment.
 */
export function freshnessReading(
  name: string,
  label: string,
  lastProgressAt: string | null,
  nowMs: number,
  maxAgeMinutes: number,
): HealthReading {
  if (!lastProgressAt) {
    return { name, ok: false, detail: `${label} has never recorded progress for this deployment.` };
  }
  const ageMinutes = Math.round((nowMs - new Date(lastProgressAt).getTime()) / 60_000);
  const ok = ageMinutes <= maxAgeMinutes;
  return {
    name,
    ok,
    detail: ok
      ? `${label} last progressed ${ageMinutes} min ago`
      : `${label} has not progressed for ${ageMinutes} min (limit ${maxAgeMinutes}). Check the Supabase cron jobs and the function logs.`,
  };
}

/** Hours between repeat alerts for a check that stays failing. */
export const REALERT_AFTER_HOURS = 12;

/**
 * Whether to email admins about a failing check: when it starts failing, and
 * again only after the quiet period if it is still failing. A check that is
 * passing never alerts.
 */
export function shouldAlert(
  reading: HealthReading,
  previous: { failing: boolean; alerted_at: string | null } | null,
  nowMs: number,
): boolean {
  if (reading.ok) return false;
  if (!previous?.failing || !previous.alerted_at) return true;
  return nowMs - new Date(previous.alerted_at).getTime() >= REALERT_AFTER_HOURS * 3_600_000;
}

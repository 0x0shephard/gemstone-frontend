import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REALERT_AFTER_HOURS,
  formatEth,
  freshnessReading,
  gasReading,
  shouldAlert,
} from './healthChecks';

const NOW = Date.parse('2026-11-05T12:00:00Z');

describe('health check readings', () => {
  it('flags the operator below its gas minimum', () => {
    const minimum = 300_000_000_000_000n;
    expect(gasReading('0x89c2', 281_378_277_505_739n, minimum)).toMatchObject({
      name: 'operator_gas',
      ok: false,
    });
    expect(gasReading('0x89c2', minimum, minimum).ok).toBe(true);
    expect(formatEth(281_378_277_505_739n)).toBe('0.000281');
  });

  it('treats a sweep with no or old progress as failing', () => {
    expect(freshnessReading('demand_sweep', 'Demand ingest', null, NOW, 150).ok).toBe(false);
    expect(
      freshnessReading('demand_sweep', 'Demand ingest', '2026-11-05T10:00:00Z', NOW, 150).ok,
    ).toBe(true);
    expect(
      freshnessReading('demand_sweep', 'Demand ingest', '2026-11-05T09:00:00Z', NOW, 150).ok,
    ).toBe(false);
  });
});

describe('alert cadence', () => {
  const failing = { name: 'operator_gas', ok: false, detail: 'low' };

  it('alerts when a check starts failing and never when it passes', () => {
    expect(shouldAlert(failing, null, NOW)).toBe(true);
    expect(shouldAlert(failing, { failing: false, alerted_at: null }, NOW)).toBe(true);
    expect(shouldAlert({ ...failing, ok: true }, null, NOW)).toBe(false);
  });

  it('repeats only after the quiet period', () => {
    const recent = new Date(NOW - 60 * 60_000).toISOString();
    const old = new Date(NOW - REALERT_AFTER_HOURS * 3_600_000).toISOString();
    expect(shouldAlert(failing, { failing: true, alerted_at: recent }, NOW)).toBe(false);
    expect(shouldAlert(failing, { failing: true, alerted_at: old }, NOW)).toBe(true);
  });
});

describe('supabase scheduler migration', () => {
  const migration = readFileSync(
    join(process.cwd(), 'supabase/migrations/202611050001_supabase_scheduler.sql'),
    'utf8',
  );

  it('schedules every sweep and the health check through the vault-backed helper', () => {
    for (const [job, fn, header, secret] of [
      [
        'dc-auction-refresh',
        'v1-auction-refresh',
        'x-auction-refresh-secret',
        'auction_refresh_secret',
      ],
      [
        'dc-demand-refresh',
        'v1-demand-refresh',
        'x-demand-refresh-secret',
        'demand_refresh_secret',
      ],
      ['dc-notify-sweep', 'v1-notify-sweep', 'x-notify-sweep-secret', 'notify_sweep_secret'],
      ['dc-health-check', 'v1-health-check', 'x-health-check-secret', 'health_check_secret'],
    ]) {
      expect(migration).toContain(`'${job}'`);
      expect(migration).toContain(
        `private.invoke_scheduled_function('${fn}', '${header}', '${secret}')`,
      );
    }
  });

  it('keeps secrets in Vault and the helpers out of the API', () => {
    expect(migration).toContain('from vault.decrypted_secrets');
    expect(migration).not.toMatch(/x-[a-z-]+-secret', '[0-9a-f]{16,}/);
    expect(migration).toContain(
      'revoke all on function private.invoke_scheduled_function(text, text, text)',
    );
    expect(migration).toContain(
      'revoke all on function private.set_scheduler_secret(text, text) from public, anon, authenticated',
    );
    expect(migration).toContain('revoke all on public.health_alert_state from anon, authenticated');
  });

  it('no longer schedules the sweeps on GitHub', () => {
    const workflow = readFileSync(
      join(process.cwd(), '.github/workflows/scheduled-sweeps.yml'),
      'utf8',
    );
    expect(workflow).not.toMatch(/^\s+schedule:/m);
    expect(workflow).toContain('workflow_dispatch:');
  });
});

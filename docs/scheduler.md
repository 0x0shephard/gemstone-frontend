# Scheduled jobs (Supabase pg_cron)

Since 2026-11-05 the protocol's scheduled jobs run inside Supabase rather than on GitHub Actions.
GitHub had been running the "hourly" sweep every 5–7 hours, and on 2026-11-05 a billing lock stopped
Actions altogether. pg_cron calls the same Edge Functions on time, through pg_net, independent of
GitHub.

Migration: `supabase/migrations/202611050001_supabase_scheduler.sql`.

| Job                  | Schedule (UTC) | Function             | Does                                                                     |
| -------------------- | -------------- | -------------------- | ------------------------------------------------------------------------ |
| `dc-auction-refresh` | `:05` hourly   | `v1-auction-refresh` | settles won auctions, reopens unsold ones                                |
| `dc-demand-refresh`  | `:20` hourly   | `v1-demand-refresh`  | ingests bids into the pricing demand counts                              |
| `dc-notify-sweep`    | every 15 min   | `v1-notify-sweep`    | offer, swap, outbid and redemption notifications; reconciles redemptions |
| `dc-health-check`    | `:40` hourly   | `v1-health-check`    | operator gas and sweep freshness; emails admins when something breaks    |

Each job reads two values from **Supabase Vault** at run time: the functions URL
(`scheduler_functions_url`) and its own shared secret. Until those exist, a job logs a warning and
does nothing. No secret is in git.

## One-time setup

Run these from the repo. The first command makes new random secrets, stores them as Edge Function
secrets, and stores the same values in Vault. Nothing is printed.

```bash
npx supabase db push --linked
```

```bash
A=$(openssl rand -hex 32) D=$(openssl rand -hex 32) N=$(openssl rand -hex 32) H=$(openssl rand -hex 32) && npx supabase secrets set --project-ref ozqesbzewekolpeaxaux AUCTION_REFRESH_SECRET=$A DEMAND_REFRESH_SECRET=$D NOTIFY_SWEEP_SECRET=$N HEALTH_CHECK_SECRET=$H && npx supabase db query --linked "select private.set_scheduler_secret('scheduler_functions_url','https://ozqesbzewekolpeaxaux.supabase.co/functions/v1'), private.set_scheduler_secret('auction_refresh_secret','$A'), private.set_scheduler_secret('demand_refresh_secret','$D'), private.set_scheduler_secret('notify_sweep_secret','$N'), private.set_scheduler_secret('health_check_secret','$H');" >/dev/null && echo "scheduler secrets set"
```

```bash
npx supabase functions deploy --project-ref ozqesbzewekolpeaxaux
```

The functions deploy is needed for the new `v1-health-check`.

Optional: `OPERATOR_MIN_GAS_ETH` (default `0.0003`) sets the gas alert threshold.

Rotating the secrets later is the same second command. The GitHub secrets for the manual fallback
workflow (`.github/workflows/scheduled-sweeps.yml`) then go stale; update them there if you ever run
it.

## Checking it works

```bash
npx supabase db query --linked "select jobname, schedule, active from cron.job order by jobname;"
```

```bash
npx supabase db query --linked "select j.jobname, d.status, d.return_message, d.start_time from cron.job_run_details d join cron.job j using (jobid) order by d.start_time desc limit 12;"
```

```bash
npx supabase db query --linked "select id, status_code, left(content::text, 300) as body, created from net._http_response order by created desc limit 8;"
```

- `cron.job_run_details` shows whether pg_cron fired the job.
- `net._http_response`, kept for a few hours, shows what each function answered.
- A `403` means a secret in Vault and the Edge Function secret differ. Rerun the setup command.

## What stays on GitHub

These need a CI runner with Docker, browsers or Foundry. Supabase cannot run them.

- **CI** (`ci.yml`): `forge test` and the a11y Playwright check. Netlify runs `npm run check` (ABI
  check, typecheck, lint, format, unit tests, build) on every deploy and deploy preview, so the
  frontend half is covered even while Actions is down.
- **End-to-end** (`e2e.yml`): local chain, local Supabase and Playwright.
- **Live canary** (`canary.yml`):
  - Its browser page checks and the proxy-implementation check stay on GitHub.
  - Its operator-gas check now also runs hourly in `v1-health-check`.
- **Upgrade rehearsal** (`upgrade-rehearsal.yml`): Foundry fork rehearsal.

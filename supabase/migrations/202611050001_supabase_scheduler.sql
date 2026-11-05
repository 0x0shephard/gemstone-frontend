-- Run the protocol's scheduled jobs from Supabase instead of GitHub Actions.
--
-- The hourly sweeps lived in .github/workflows/scheduled-sweeps.yml. GitHub
-- delayed them to every 5-7 hours on this quiet repository, and on 2026-11-05 a
-- billing lock stopped Actions altogether, so won auctions stopped settling and
-- notifications stopped going out. pg_cron runs inside the database and calls
-- the same Edge Functions through pg_net, on time and independent of GitHub.
--
-- Nothing secret is stored here. Each job reads the functions URL and its
-- shared secret from Supabase Vault at run time; until those exist the job logs
-- a warning and does nothing. See docs/scheduler.md for the one-time setup.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

/*
 * Calls one scheduled Edge Function with its shared-secret header.
 *
 * Fire-and-forget: pg_net sends the request in the background and records the
 * response in net._http_response for a few hours, which is where to look when a
 * job misbehaves. The timeout matches the Edge Function wall-clock limit so a
 * long scan is not cut off from this side.
 */
create or replace function private.invoke_scheduled_function(
  p_function text,
  p_secret_header text,
  p_secret_name text
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'scheduler_functions_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = p_secret_name;
  if v_url is null or v_secret is null then
    raise warning 'scheduler: % skipped; vault secret scheduler_functions_url or % is missing',
      p_function, p_secret_name;
    return null;
  end if;
  select net.http_post(
    url := rtrim(v_url, '/') || '/' || p_function,
    headers := jsonb_build_object('content-type', 'application/json', p_secret_header, v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function private.invoke_scheduled_function(text, text, text)
  from public, anon, authenticated;

/*
 * Creates or replaces one scheduler secret in Vault. For the one-time setup in
 * docs/scheduler.md, run by the project owner; never callable from the API.
 */
create or replace function private.set_scheduler_secret(p_name text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_name not in (
    'scheduler_functions_url',
    'auction_refresh_secret',
    'demand_refresh_secret',
    'notify_sweep_secret',
    'health_check_secret'
  ) then
    raise exception 'unknown scheduler secret %', p_name;
  end if;
  if coalesce(length(p_value), 0) < 16 then
    raise exception 'scheduler secret % is too short', p_name;
  end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end;
$$;

revoke all on function private.set_scheduler_secret(text, text) from public, anon, authenticated;

/*
 * Alert bookkeeping for v1-health-check, so a failing check emails the admins
 * once (and again only after a quiet period) rather than every hour. Read and
 * written by the service role only.
 */
create table if not exists public.health_alert_state (
  check_name text primary key,
  failing boolean not null default false,
  detail text,
  alerted_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.health_alert_state enable row level security;
revoke all on public.health_alert_state from anon, authenticated;

-- Schedules. `cron.schedule` with an existing name replaces that job, so this
-- migration can be re-run safely. Minutes are staggered so the jobs, which share
-- the operator key, do not start together; notifications run last in the hour
-- and again every 15 minutes, because offers expire within 24 hours.
select cron.schedule(
  'dc-auction-refresh', '5 * * * *',
  $$select private.invoke_scheduled_function('v1-auction-refresh', 'x-auction-refresh-secret', 'auction_refresh_secret')$$
);
select cron.schedule(
  'dc-demand-refresh', '20 * * * *',
  $$select private.invoke_scheduled_function('v1-demand-refresh', 'x-demand-refresh-secret', 'demand_refresh_secret')$$
);
select cron.schedule(
  'dc-notify-sweep', '*/15 * * * *',
  $$select private.invoke_scheduled_function('v1-notify-sweep', 'x-notify-sweep-secret', 'notify_sweep_secret')$$
);
select cron.schedule(
  'dc-health-check', '40 * * * *',
  $$select private.invoke_scheduled_function('v1-health-check', 'x-health-check-secret', 'health_check_secret')$$
);

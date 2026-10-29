-- KYC (Sumsub): the tables the Edge Functions write, and one source of truth.
--
-- v1-sumsub-token and v1-sumsub-webhook have always written `kyc_profiles` and
-- `sumsub_webhook_events`, but neither table was ever created by a migration
-- (they existed only in the legacy schema.sql reference), so every KYC write
-- failed. Meanwhile the page read `kyc_status`, a legacy table from before the
-- first migration that nothing in this repository writes.
--
-- After this migration:
--   kyc_profiles           the only KYC table. Written by the service role only
--                          (token issue and webhook); a user may read their own
--                          status, and only the status columns.
--   sumsub_webhook_events  one row per signed delivery, service role only.
--   kyc_status             a view over kyc_profiles, kept so any reader of the
--                          old name sees the same answer.
--   kyc_status_legacy      the old table, renamed and closed to clients. Its
--                          rows are NOT imported: Sumsub never reached this
--                          database, so any status in it was not set by a KYC
--                          review, and before 202607250001 clients could write
--                          it. Nothing is deleted; review and drop it by hand.

create table if not exists public.kyc_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  applicant_id text,
  applicant_type text not null default 'individual'
    check (applicant_type in ('individual', 'company')),
  status text not null default 'not_started'
    check (status in ('not_started', 'pending', 'approved', 'rejected', 'on_hold')),
  -- Sumsub's own words, kept for support: reviewStatus and reviewResult.
  review_status text,
  review_result jsonb,
  level_name text,
  -- Sumsub's createdAt for the last event applied. Orders deliveries.
  last_event_at timestamptz,
  last_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- In case the table was created earlier from schema.sql, which lacked these.
alter table public.kyc_profiles
  add column if not exists review_status text,
  add column if not exists level_name text,
  add column if not exists last_event_at timestamptz,
  add column if not exists last_event_id text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists kyc_profiles_applicant
  on public.kyc_profiles (applicant_id)
  where applicant_id is not null;

drop trigger if exists kyc_profiles_set_updated_at on public.kyc_profiles;
create trigger kyc_profiles_set_updated_at
before update on public.kyc_profiles
for each row execute function public.set_updated_at();

comment on table public.kyc_profiles is
  'Sumsub KYC state per profile. Written only by v1-sumsub-token (row creation) and v1-sumsub-webhook (via apply_sumsub_webhook_event).';

alter table public.kyc_profiles enable row level security;
revoke all on table public.kyc_profiles from anon, authenticated;
-- Only the status. review_result can hold reviewer notes meant for compliance.
grant select (profile_id, status, updated_at) on public.kyc_profiles to authenticated;
grant all on table public.kyc_profiles to service_role;

drop policy if exists kyc_profiles_read_own on public.kyc_profiles;
create policy kyc_profiles_read_own
on public.kyc_profiles for select
to authenticated
using ((select auth.uid()) = profile_id);

create table if not exists public.sumsub_webhook_events (
  -- SHA-256 of the signed body: a redelivery is byte-identical.
  event_id text primary key,
  event_type text not null,
  correlation_id text,
  -- No foreign key: an event for a profile that does not exist is still kept.
  profile_id uuid,
  applicant_id text,
  review_status text,
  status text,
  event_created_at timestamptz not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text not null default 'applied'
    check (outcome in ('applied', 'stale', 'ignored', 'unknown_profile')),
  processed_at timestamptz not null default now()
);

alter table public.sumsub_webhook_events
  add column if not exists correlation_id text,
  add column if not exists profile_id uuid,
  add column if not exists applicant_id text,
  add column if not exists review_status text,
  add column if not exists status text,
  add column if not exists event_created_at timestamptz,
  add column if not exists outcome text not null default 'applied';

create index if not exists sumsub_webhook_events_profile
  on public.sumsub_webhook_events (profile_id, event_created_at desc);

alter table public.sumsub_webhook_events enable row level security;
revoke all on table public.sumsub_webhook_events from anon, authenticated;
grant all on table public.sumsub_webhook_events to service_role;

/*
 * Records one signed Sumsub delivery and applies it, in one transaction.
 *
 * Returns:
 *   duplicate        this exact body was handled before; nothing changes
 *   applied          the profile's status now reflects this event
 *   stale            an event Sumsub created later was already applied
 *   ignored          the event type says nothing about the review
 *   unknown_profile  externalUserId names no profile here
 *
 * Ordering is by Sumsub's createdAt, per profile, under an advisory lock so two
 * concurrent deliveries cannot both pass the comparison. An event at the same
 * instant as the last applied one is applied (the later delivery wins).
 */
create or replace function public.apply_sumsub_webhook_event(
  p_event_id text,
  p_event_type text,
  p_payload_sha256 text,
  p_correlation_id text,
  p_profile_id uuid,
  p_applicant_id text,
  p_status text,
  p_review_status text,
  p_review_result jsonb,
  p_level_name text,
  p_event_created_at timestamptz
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_outcome text;
  changed integer;
begin
  if p_event_id is null or p_profile_id is null or p_event_created_at is null then
    raise exception 'event id, profile id and event time are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sumsub:' || p_profile_id::text, 0));

  if exists (select 1 from public.sumsub_webhook_events where event_id = p_event_id) then
    return 'duplicate';
  end if;

  if not exists (select 1 from public.profiles where id = p_profile_id) then
    v_outcome := 'unknown_profile';
  elsif p_status is null then
    v_outcome := 'ignored';
  else
    insert into public.kyc_profiles as existing (
      profile_id,
      applicant_id,
      status,
      review_status,
      review_result,
      level_name,
      last_event_at,
      last_event_id
    ) values (
      p_profile_id,
      p_applicant_id,
      p_status,
      p_review_status,
      p_review_result,
      p_level_name,
      p_event_created_at,
      p_event_id
    )
    on conflict (profile_id) do update
    set applicant_id = coalesce(excluded.applicant_id, existing.applicant_id),
        status = excluded.status,
        review_status = excluded.review_status,
        review_result = excluded.review_result,
        level_name = coalesce(excluded.level_name, existing.level_name),
        last_event_at = excluded.last_event_at,
        last_event_id = excluded.last_event_id
    where existing.last_event_at is null
       or existing.last_event_at <= excluded.last_event_at;
    get diagnostics changed = row_count;
    v_outcome := case when changed > 0 then 'applied' else 'stale' end;
  end if;

  insert into public.sumsub_webhook_events (
    event_id,
    event_type,
    correlation_id,
    profile_id,
    applicant_id,
    review_status,
    status,
    event_created_at,
    payload_sha256,
    outcome
  ) values (
    p_event_id,
    p_event_type,
    p_correlation_id,
    p_profile_id,
    p_applicant_id,
    p_review_status,
    p_status,
    p_event_created_at,
    p_payload_sha256,
    v_outcome
  )
  on conflict (event_id) do nothing;

  return v_outcome;
end;
$$;

revoke all on function public.apply_sumsub_webhook_event(
  text, text, text, text, uuid, text, text, text, jsonb, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_sumsub_webhook_event(
  text, text, text, text, uuid, text, text, text, jsonb, text, timestamptz
) to service_role;

-- The legacy table steps aside; its name becomes a view of the real one.
do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'kyc_status'
      and c.relkind in ('r', 'p')
  ) then
    if to_regclass('public.kyc_status_legacy') is not null then
      raise exception 'public.kyc_status_legacy already exists; resolve it by hand';
    end if;
    alter table public.kyc_status rename to kyc_status_legacy;
    revoke all on table public.kyc_status_legacy from anon, authenticated;
    comment on table public.kyc_status_legacy is
      'Pre-migration KYC table, superseded by kyc_profiles (202610300302). Not read by the app; rows were not imported.';
  end if;
end
$$;

-- security_invoker: the caller's own grants and kyc_profiles RLS apply, so a
-- user still sees only their own row.
create or replace view public.kyc_status
with (security_invoker = true)
as
select profile_id as user_id, status, updated_at
from public.kyc_profiles;

revoke all on table public.kyc_status from anon, authenticated;
grant select on table public.kyc_status to authenticated;
grant select on table public.kyc_status to service_role;

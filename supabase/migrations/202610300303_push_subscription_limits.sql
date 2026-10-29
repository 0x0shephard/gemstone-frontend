-- Bound and validate Web Push subscriptions.
--
-- The endpoint is a URL the browser writes through the user's own session, and
-- the sweep POSTs to it with the service's credentials. Unchecked, that is a
-- server-side request to any address a user chooses (SSRF), and with no limit
-- on rows, one account could make the sweep do it thousands of times per
-- notification.
--
--   * An endpoint must be https on a known push service: FCM (Chrome and
--     Chromium browsers), Mozilla autopush (Firefox), Apple Web Push (Safari)
--     or WNS (Edge on Windows). No port, no credentials, a path required.
--     Mirrored by isAllowedPushEndpoint in supabase/functions/_shared/webpush.ts.
--   * At most 10 rows per account. A new device prunes the least recently used
--     ones (retired rows first) rather than failing, so a person who replaces a
--     phone is never locked out of notifications.

create or replace function public.guard_push_subscription()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  max_per_profile constant integer := 10;
begin
  if new.endpoint is null
     or length(new.endpoint) > 2048
     or new.endpoint !~* '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)/[^[:space:]]*$'
  then
    raise exception 'push_endpoint_not_allowed'
      using errcode = '22023',
            hint = 'Push endpoints must be https URLs on FCM, Mozilla, Apple or WNS.';
  end if;

  -- An upsert of an endpoint already stored becomes an update; nothing to prune.
  if tg_op = 'INSERT'
     and not exists (
       select 1 from public.push_subscriptions where endpoint = new.endpoint
     )
  then
    perform pg_advisory_xact_lock(hashtextextended('push:' || new.profile_id::text, 0));
    delete from public.push_subscriptions
    where id in (
      select id
      from public.push_subscriptions
      where profile_id = new.profile_id
      order by (expired_at is null) desc, coalesce(last_used_at, created_at) desc
      offset max_per_profile - 1
    );
  end if;

  return new;
end;
$$;

-- Rows written before this check: retire any that the sweep must not call.
update public.push_subscriptions
set expired_at = now()
where expired_at is null
  and (
    length(endpoint) > 2048
    or endpoint !~* '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)/[^[:space:]]*$'
  );

-- And bring every account down to the limit, keeping the most recently used.
delete from public.push_subscriptions
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by profile_id
        order by (expired_at is null) desc, coalesce(last_used_at, created_at) desc
      ) as position
    from public.push_subscriptions
  ) ranked
  where ranked.position > 10
);

drop trigger if exists push_subscriptions_guard on public.push_subscriptions;
create trigger push_subscriptions_guard
before insert or update of endpoint on public.push_subscriptions
for each row execute function public.guard_push_subscription();

create index if not exists push_subscriptions_profile_all
  on public.push_subscriptions (profile_id, created_at);

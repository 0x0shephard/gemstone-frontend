-- Rate-limit SIWE nonces and clean up the ones that can no longer be used.
--
-- v1-siwe-nonce inserted a row on every call with no limit and nothing ever
-- removed one, so any signed-in account could grow the table without bound.
--
-- Limit: 10 nonces per account in any 10-minute window (the nonce lifetime).
-- The app asks for one when a wallet connects and one more for a relink, so a
-- person never comes near it. The trigger raises `siwe_nonce_rate_limited`,
-- which v1-siwe-nonce turns into a 429.
--
-- Cleanup without a scheduler (pg_cron is not used in this project): each
-- issue deletes the caller's own nonces that expired over an hour ago, plus up
-- to 200 anyone's that expired over a day ago. Deleting an expired nonce
-- changes nothing for verification, which already refuses it.

create or replace function public.guard_siwe_nonce()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  max_per_window constant integer := 10;
  recent integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('siwe:' || new.profile_id::text, 0));

  delete from public.siwe_nonces
  where profile_id = new.profile_id
    and expires_at < now() - interval '1 hour';

  delete from public.siwe_nonces
  where id in (
    select id
    from public.siwe_nonces
    where expires_at < now() - interval '1 day'
    limit 200
    for update skip locked
  );

  select count(*) into recent
  from public.siwe_nonces
  where profile_id = new.profile_id
    and created_at > now() - interval '10 minutes';

  if recent >= max_per_window then
    raise exception 'siwe_nonce_rate_limited'
      using errcode = 'P0001',
            hint = 'Too many SIWE nonces issued for this account; retry in a few minutes.';
  end if;

  return new;
end;
$$;

drop trigger if exists siwe_nonces_rate_limit on public.siwe_nonces;
create trigger siwe_nonces_rate_limit
before insert on public.siwe_nonces
for each row execute function public.guard_siwe_nonce();

create index if not exists siwe_nonces_expires
  on public.siwe_nonces (expires_at);

-- The backlog to date.
delete from public.siwe_nonces
where expires_at < now() - interval '1 day';

-- Clearing a notification.
--
-- Hidden, not deleted, and the distinction is load-bearing. Notifications are
-- deduplicated by a unique index on `(wallet_address, kind, entity_type,
-- entity_id)`, and the sweep re-derives the same open offer on every hourly
-- pass. Delete the row and the very next run inserts it again — clearing your
-- list would appear to work and then silently undo itself within the hour.
--
-- Keeping the row keeps the deduplication, so a cleared notification stays
-- cleared. `read_at` cannot serve here either: read is "I have seen this", while
-- dismissed is "stop showing me this", and the unread badge needs to tell them
-- apart.

alter table public.notifications
  add column if not exists dismissed_at timestamptz;

comment on column public.notifications.dismissed_at is
  'When the reader cleared this from their list. The row survives so the sweep''s deduplication still holds and the notification is not recreated on the next pass.';

create index if not exists notifications_profile_visible
  on public.notifications (profile_id, created_at desc)
  where dismissed_at is null;

-- The guard trigger rewrites every column a reader must not change. It predates
-- this one, so without adding it here a dismissal would be silently reverted —
-- the same failure the trigger caused for the sweep's own `emailed_at`.
create or replace function public.notifications_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Readers only. The sweep writes through the service role, and RLS is not what
  -- would stop it here: triggers fire whoever is connected, so an unconditional
  -- guard would revert the sweep's own bookkeeping and make it re-send
  -- everything on the next pass.
  if current_user <> 'authenticated' then
    return new;
  end if;

  -- `read_at` and `dismissed_at` are the reader's to write. Everything else is
  -- restored silently, which keeps a well-behaved client working while making a
  -- crafted update pointless.
  new.wallet_address := old.wallet_address;
  new.profile_id := old.profile_id;
  new.kind := old.kind;
  new.title := old.title;
  new.body := old.body;
  new.action_path := old.action_path;
  new.entity_type := old.entity_type;
  new.entity_id := old.entity_id;
  new.expires_at := old.expires_at;
  new.emailed_at := old.emailed_at;
  new.pushed_at := old.pushed_at;
  new.created_at := old.created_at;
  return new;
end;
$$;

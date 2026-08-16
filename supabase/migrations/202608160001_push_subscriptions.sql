-- Web Push subscriptions.
--
-- The in-app feed reaches people who are already using the site, and email
-- reaches everyone but is too heavy for routine news. Push is the channel for
-- the case in between: something needs attention and the tab is closed.
--
-- A subscription is a device, not a person. The same account on a laptop and a
-- phone is two rows, and both should ring.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references auth.users(id) on delete cascade,

  -- The push service's URL for this device. Unique by construction: the browser
  -- returns the same endpoint until the subscription is revoked, so re-running
  -- the subscribe flow must update a row rather than accumulate them.
  endpoint text not null unique,
  -- RFC 8291 keys. `p256dh` is the device's public key and `auth` its shared
  -- secret; both are needed to encrypt a payload the device will accept.
  p256dh text not null,
  auth text not null,

  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- Set when the push service reports the subscription gone (404/410). Kept
  -- rather than deleted so a device that unsubscribes and returns is one row.
  expired_at timestamptz
);

create index if not exists push_subscriptions_profile
  on public.push_subscriptions (profile_id)
  where expired_at is null;

comment on table public.push_subscriptions is
  'Web Push endpoints, one per device. Rows are retired by setting expired_at when the push service reports the endpoint gone, never by deleting mid-send.';

alter table public.push_subscriptions enable row level security;

-- A reader manages only their own devices. The sweep reads them through the
-- service role, which bypasses RLS.
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own
on public.push_subscriptions for all
to authenticated
using (profile_id = (select auth.uid()))
with check (profile_id = (select auth.uid()));

grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Which channels a notification actually went out on.
--
-- `emailed_at` already recorded one channel; recording the other keeps the
-- question "was this person told, and how" answerable from one row.
alter table public.notifications
  add column if not exists pushed_at timestamptz;

comment on column public.notifications.pushed_at is
  'When this was delivered as a Web Push, if it was. Null means push was not attempted or no device was subscribed.';

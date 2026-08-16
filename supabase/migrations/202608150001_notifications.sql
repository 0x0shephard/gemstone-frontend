-- Notifications.
--
-- The protocol had no way to tell anyone anything. Every deadline in it — a
-- 24-hour offer, a swap holding someone's NFT in escrow, an auction about to
-- close — was discoverable only by opening the right tab at the right moment,
-- and the assets those deadlines strand are real. This is the record of what
-- each person has been told, and what they still need to act on.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),

  -- Addressed to a wallet first and a profile second. Tokens reach people who
  -- have never signed up — a gift, a plain transfer — so the wallet is the only
  -- identifier always present. `profile_id` is filled when the wallet is linked,
  -- and is what makes the row visible in the app and reachable by email.
  wallet_address text not null
    constraint notifications_wallet_check check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  profile_id uuid references auth.users(id) on delete cascade,

  kind text not null,
  title text not null,
  body text not null,
  -- Where acting on this happens. Relative, so it survives a domain change.
  action_path text,

  -- What this is about, for deduplication and for the audit trail.
  entity_type text not null,
  entity_id text not null,

  -- Deadline this notification is warning about, when it has one. Lets a sweep
  -- skip re-notifying about something that has already lapsed.
  expires_at timestamptz,

  emailed_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- One notification per person per thing per kind, ever.
--
-- The sweep is not a queue reader: it re-derives state from the chain on every
-- pass and will see the same open offer hour after hour. Without this the first
-- unclaimed offer would mail its owner every hour until it expired. Making the
-- database refuse the duplicate — rather than the sweep remembering not to send
-- it — means a sweep that crashes and reruns cannot double-send either.
create unique index if not exists notifications_unique_event
  on public.notifications (wallet_address, kind, entity_type, entity_id);

create index if not exists notifications_profile_unread
  on public.notifications (profile_id, created_at desc)
  where read_at is null;

create index if not exists notifications_pending_email
  on public.notifications (created_at)
  where emailed_at is null;

comment on table public.notifications is
  'What each wallet has been told about state that needs its attention. Deduplicated by (wallet, kind, entity), so a sweep re-deriving the same open offer cannot notify twice.';
comment on column public.notifications.wallet_address is
  'Addressee. A wallet rather than a profile because tokens reach people with no account, and those holders still have deadlines.';
comment on column public.notifications.expires_at is
  'When the thing being warned about lapses, so a late sweep can skip a warning that is already moot.';

alter table public.notifications enable row level security;

-- Read-only to the addressee, and only once their wallet is linked. Writes are
-- the sweep's alone, through the service role, which bypasses RLS.
drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own
on public.notifications for select
to authenticated
using (profile_id = (select auth.uid()));

-- Marking something read is the one change a reader may make. Restricted to
-- that column by the trigger below rather than by the policy, which cannot
-- express it.
drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read
on public.notifications for update
to authenticated
using (profile_id = (select auth.uid()))
with check (profile_id = (select auth.uid()));

-- Not `security definer`: a BEFORE trigger only rewrites the row being written,
-- and needs no privilege beyond the caller's to do it.
create or replace function public.notifications_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Readers only. The sweep writes `emailed_at` through the service role, and
  -- RLS is not what would stop it here — triggers fire whoever is connected, so
  -- an unconditional guard would silently revert the sweep's own bookkeeping and
  -- make it re-send every message on the next pass.
  if current_user <> 'authenticated' then
    return new;
  end if;

  -- Everything except `read_at` is the sweep's to write. Silently restoring the
  -- old values keeps a well-behaved client working while making a crafted
  -- update pointless.
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
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists notifications_guard_update on public.notifications;
create trigger notifications_guard_update
  before update on public.notifications
  for each row execute function public.notifications_guard_update();

grant select, update on public.notifications to authenticated;

-- How far the notification sweep has read each contract.
--
-- Per contract rather than a single cursor: they were deployed at different
-- blocks, and one of them falling behind must not drag the others back over
-- ground they have already covered.
create table if not exists public.notification_scan_state (
  contract text primary key,
  scanned_through_block bigint not null,
  updated_at timestamptz not null default now()
);

comment on table public.notification_scan_state is
  'Per-contract high-water mark for the notification sweep. Committed as the scan proceeds so a run that stops on its time budget resumes rather than restarts.';

-- Open positions with a deadline, and who to warn when it passes.
--
-- A log scan can only see what happened inside the window it read. The thing
-- that needs warning about here is the opposite: an offer created weeks ago
-- whose expiry is *today*, holding someone's money — or worse, a swap holding
-- their NFT. Recording the deadline when the position opens turns "search all of
-- history every hour" into a dated query.
create table if not exists public.notification_watch (
  id uuid primary key default gen_random_uuid(),
  -- 'offer' | 'swap' | 'auction'
  kind text not null,
  entity_id text not null,

  -- Who is left holding something if this lapses: the bidder on a marketplace
  -- offer, the proposer on a swap, the outbid party on an auction.
  beneficiary_wallet text not null
    constraint notification_watch_wallet_check check (beneficiary_wallet ~ '^0x[0-9a-f]{40}$'),

  expires_at timestamptz not null,
  -- Set once the position closes or the warning has been sent. Either way there
  -- is nothing further to say about it.
  resolved_at timestamptz,
  created_at timestamptz not null default now(),

  constraint notification_watch_unique unique (kind, entity_id, beneficiary_wallet)
);

create index if not exists notification_watch_due
  on public.notification_watch (expires_at)
  where resolved_at is null;

comment on table public.notification_watch is
  'Open escrow positions and their deadlines. Written when the position opens so the expiry warning is a dated query rather than a full history rescan.';
comment on column public.notification_watch.beneficiary_wallet is
  'Who is left holding something if this lapses — the party who must act to recover it, not the counterparty.';

alter table public.notification_watch enable row level security;
-- No policies: this is sweep bookkeeping. The service role bypasses RLS, and
-- nothing in it is worth exposing that the notifications table does not already.

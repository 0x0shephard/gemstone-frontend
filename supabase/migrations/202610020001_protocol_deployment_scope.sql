-- Isolate every chain-derived workflow row by protocol deployment.
--
-- Sepolia token, gem, offer and swap identifiers all restart at small integers
-- when the suite is redeployed.  Keeping them as global keys would make a fresh
-- token #1 collide with the archived suite's token #1.  Existing rows are kept
-- in place under the legacy deployment; no user, account, evidence or audit row
-- is deleted.

create table if not exists public.protocol_deployments (
  id text primary key,
  chain_id bigint not null,
  deployment_block bigint not null check (deployment_block >= 0),
  dge_nft_address text not null check (dge_nft_address ~* '^0x[0-9a-f]{40}$'),
  gem_registry_address text not null check (gem_registry_address ~* '^0x[0-9a-f]{40}$'),
  marketplace_address text not null check (marketplace_address ~* '^0x[0-9a-f]{40}$'),
  primary_sale_auction_address text not null check (primary_sale_auction_address ~* '^0x[0-9a-f]{40}$'),
  redemption_manager_address text not null check (redemption_manager_address ~* '^0x[0-9a-f]{40}$'),
  swap_escrow_address text not null check (swap_escrow_address ~* '^0x[0-9a-f]{40}$'),
  requires_client_release boolean not null default true,
  status text not null check (status in ('staging', 'active', 'archived')),
  activated_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists protocol_deployments_one_active
  on public.protocol_deployments ((status))
  where status = 'active';

alter table public.protocol_deployments enable row level security;

insert into public.protocol_deployments (
  id,
  chain_id,
  deployment_block,
  dge_nft_address,
  gem_registry_address,
  marketplace_address,
  primary_sale_auction_address,
  redemption_manager_address,
  swap_escrow_address,
  requires_client_release,
  status,
  activated_at
) values (
  'sepolia-11155111-40fe3f22',
  11155111,
  11342041,
  lower('0x40FE3f22f2B6Ea5e0436f56c0d821bEF8D4c39f6'),
  lower('0xC46D6870B7298b4cf0BcbcD1feC563EBC887cB2d'),
  lower('0x9C1aD06bA5702EA40131dAD626572b74C411F93A'),
  lower('0xCBF8E2596680de83121BE35952707725c4a959A1'),
  lower('0x5fB27142A69938FCf94ceE5183288a0a6B3c0fFE'),
  lower('0xCadC4f1d3F3be596eD205437BA3b0B12B69A4888'),
  false,
  'active',
  now()
)
on conflict (id) do nothing;

create or replace function public.current_protocol_deployment_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.protocol_deployments
  where status = 'active'
  limit 1;
$$;

revoke all on function public.current_protocol_deployment_id() from public;
grant execute on function public.current_protocol_deployment_id() to anon, authenticated, service_role;

-- The browser needs only the opaque deployment id for scoped reads.  Complete
-- address validation remains service-role-only in the Edge helper.
create or replace function public.current_protocol_deployment()
returns table (deployment_id text)
language sql
stable
security definer
set search_path = public
as $$
  select public.current_protocol_deployment_id();
$$;

revoke all on function public.current_protocol_deployment() from public;
grant execute on function public.current_protocol_deployment() to anon, authenticated, service_role;

-- The release carried by the browser request. Headerless pre-cutover bundles
-- remain pinned to the legacy deployment after it is archived, so they can
-- never mistake fresh token #1 for legacy token #1. Unknown releases simply
-- match no rows.
create or replace function public.requested_protocol_deployment_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(
      (nullif(current_setting('request.headers', true), '')::jsonb
        ->> 'x-protocol-deployment'),
      ''
    ),
    'sepolia-11155111-40fe3f22'
  );
$$;

revoke all on function public.requested_protocol_deployment_id() from public;
grant execute on function public.requested_protocol_deployment_id() to anon, authenticated, service_role;

create or replace function public.requested_protocol_deployment_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.protocol_deployments
    where id = public.requested_protocol_deployment_id()
      and status = 'active'
  );
$$;

revoke all on function public.requested_protocol_deployment_is_active() from public;
grant execute on function public.requested_protocol_deployment_is_active() to anon, authenticated, service_role;

create or replace function public.activate_protocol_deployment(
  expected_current_id text,
  next_deployment_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_id text;
begin
  -- Serialise cutovers and make the old->new switch visible only at commit.
  lock table public.protocol_deployments in exclusive mode;
  select id into current_id
  from public.protocol_deployments
  where status = 'active';
  if current_id = next_deployment_id then
    return;
  end if;
  if current_id is distinct from expected_current_id then
    raise exception 'Active deployment changed (expected %, found %)', expected_current_id, current_id;
  end if;
  if not exists (
    select 1 from public.protocol_deployments
    where id = next_deployment_id and status in ('staging', 'archived')
  ) then
    raise exception 'Next deployment is not staged or archived: %', next_deployment_id;
  end if;

  update public.protocol_deployments
  set status = 'archived', archived_at = now()
  where id = expected_current_id and status = 'active';
  update public.protocol_deployments
  set status = 'active', activated_at = now(), archived_at = null
  where id = next_deployment_id and status in ('staging', 'archived');
end;
$$;

revoke all on function public.activate_protocol_deployment(text, text) from public;
grant execute on function public.activate_protocol_deployment(text, text) to service_role;

alter table public.seller_submissions
  add column if not exists deployment_id text references public.protocol_deployments(id);
update public.seller_submissions
set deployment_id = 'sepolia-11155111-40fe3f22'
where deployment_id is null;
alter table public.seller_submissions
  alter column deployment_id set default public.current_protocol_deployment_id(),
  alter column deployment_id set not null;

alter table public.evidence_files
  add column if not exists deployment_id text references public.protocol_deployments(id);
update public.evidence_files e
set deployment_id = coalesce(s.deployment_id, 'sepolia-11155111-40fe3f22')
from public.seller_submissions s
where s.id = e.submission_id
  and e.deployment_id is null;
update public.evidence_files
set deployment_id = 'sepolia-11155111-40fe3f22'
where deployment_id is null;
alter table public.evidence_files
  alter column deployment_id set default public.requested_protocol_deployment_id(),
  alter column deployment_id set not null;

alter table public.redemption_requests
  add column if not exists deployment_id text references public.protocol_deployments(id);
update public.redemption_requests
set deployment_id = 'sepolia-11155111-40fe3f22'
where deployment_id is null;
alter table public.redemption_requests
  alter column deployment_id set default public.current_protocol_deployment_id(),
  alter column deployment_id set not null;

alter table public.gift_cards
  add column if not exists deployment_id text references public.protocol_deployments(id);
update public.gift_cards
set deployment_id = 'sepolia-11155111-40fe3f22'
where deployment_id is null;
alter table public.gift_cards
  alter column deployment_id set default public.current_protocol_deployment_id(),
  alter column deployment_id set not null;

alter table public.gift_card_events
  add column if not exists deployment_id text references public.protocol_deployments(id);
update public.gift_card_events e
set deployment_id = c.deployment_id
from public.gift_cards c
where c.id = e.gift_id
  and e.deployment_id is null;
alter table public.gift_card_events
  alter column deployment_id set default public.current_protocol_deployment_id(),
  alter column deployment_id set not null;

alter table public.auction_cycles
  add column if not exists deployment_id text references public.protocol_deployments(id);
update public.auction_cycles
set deployment_id = 'sepolia-11155111-40fe3f22'
where deployment_id is null;
alter table public.auction_cycles
  alter column deployment_id set default public.current_protocol_deployment_id(),
  alter column deployment_id set not null;
alter table public.auction_cycles drop constraint if exists auction_cycles_pkey;
alter table public.auction_cycles
  add constraint auction_cycles_pkey primary key (deployment_id, gem_id);

alter table public.demand_bids
  add column if not exists deployment_id text references public.protocol_deployments(id);
update public.demand_bids
set deployment_id = 'sepolia-11155111-40fe3f22'
where deployment_id is null;
alter table public.demand_bids
  alter column deployment_id set default public.current_protocol_deployment_id(),
  alter column deployment_id set not null;
alter table public.demand_bids drop constraint if exists demand_bids_tx_hash_log_index_key;
alter table public.demand_bids
  add constraint demand_bids_deployment_tx_log_key
  unique (deployment_id, tx_hash, log_index);

alter table public.demand_scan_state
  add column if not exists deployment_id text references public.protocol_deployments(id);
update public.demand_scan_state
set deployment_id = 'sepolia-11155111-40fe3f22'
where deployment_id is null;
alter table public.demand_scan_state
  alter column deployment_id set default public.current_protocol_deployment_id(),
  alter column deployment_id set not null;
alter table public.demand_scan_state drop constraint if exists demand_scan_state_pkey;
alter table public.demand_scan_state
  add constraint demand_scan_state_pkey primary key (deployment_id, id);

alter table public.notification_scan_state
  add column if not exists deployment_id text references public.protocol_deployments(id);
update public.notification_scan_state
set deployment_id = 'sepolia-11155111-40fe3f22'
where deployment_id is null;
alter table public.notification_scan_state
  alter column deployment_id set default public.current_protocol_deployment_id(),
  alter column deployment_id set not null;
alter table public.notification_scan_state drop constraint if exists notification_scan_state_pkey;
alter table public.notification_scan_state
  add constraint notification_scan_state_pkey primary key (deployment_id, contract);

alter table public.notification_watch
  add column if not exists deployment_id text references public.protocol_deployments(id);
update public.notification_watch
set deployment_id = 'sepolia-11155111-40fe3f22'
where deployment_id is null;
alter table public.notification_watch
  alter column deployment_id set default public.current_protocol_deployment_id(),
  alter column deployment_id set not null;
alter table public.notification_watch drop constraint if exists notification_watch_unique;
alter table public.notification_watch
  add constraint notification_watch_unique
  unique (deployment_id, kind, entity_id, beneficiary_wallet);

alter table public.notifications
  add column if not exists deployment_id text references public.protocol_deployments(id);
update public.notifications
set deployment_id = 'sepolia-11155111-40fe3f22'
where deployment_id is null;
alter table public.notifications
  alter column deployment_id set default public.current_protocol_deployment_id(),
  alter column deployment_id set not null;
drop index if exists public.notifications_unique_event;
create unique index notifications_unique_event
  on public.notifications (deployment_id, wallet_address, kind, entity_type, entity_id);

-- Audit and valuation identifiers are UUID-backed and cannot collide, but the
-- deployment tag keeps a repeated human-facing gem id intelligible later.
alter table public.audit_records
  add column if not exists deployment_id text references public.protocol_deployments(id);
update public.audit_records
set deployment_id = 'sepolia-11155111-40fe3f22'
where deployment_id is null;
alter table public.audit_records
  alter column deployment_id set default public.current_protocol_deployment_id();

alter table public.valuations
  add column if not exists deployment_id text references public.protocol_deployments(id);
update public.valuations v
set deployment_id = s.deployment_id
from public.seller_submissions s
where s.id = v.submission_id
  and v.deployment_id is null;
alter table public.valuations
  alter column deployment_id set default public.current_protocol_deployment_id(),
  alter column deployment_id set not null;

drop index if exists public.gift_cards_one_open_per_token;
create unique index gift_cards_one_open_per_token
  on public.gift_cards (deployment_id, token_id)
  where status in ('pending_escrow', 'active', 'claim_pending', 'cancel_pending');

drop index if exists public.gift_cards_sender_request;
create unique index gift_cards_sender_request
  on public.gift_cards (deployment_id, sender_id, client_request_id)
  where client_request_id is not null;

drop index if exists public.seller_submissions_client_id;
create unique index seller_submissions_client_id
  on public.seller_submissions (deployment_id, client_submission_id)
  where client_submission_id is not null;

drop index if exists public.seller_submissions_escrow_by_gem;
create index seller_submissions_escrow_by_gem
  on public.seller_submissions (deployment_id, onchain_gem_id)
  where reserve_escrow_ends_at is not null;

drop index if exists public.demand_bids_gem_bidder_idx;
create index demand_bids_gem_bidder_idx
  on public.demand_bids (deployment_id, gem_id, bidder);

-- Browser reads see only the active suite.  Old rows remain intact and can be
-- audited with the service role or by switching the active deployment during a
-- controlled rollback.
drop policy if exists seller_submissions_read_own on public.seller_submissions;
create policy seller_submissions_read_own
on public.seller_submissions for select
to authenticated
using (
  auth.uid() = seller_id
  and deployment_id = public.requested_protocol_deployment_id()
);

drop policy if exists seller_submissions_delete_incomplete on public.seller_submissions;
create policy seller_submissions_delete_incomplete
on public.seller_submissions for delete
to authenticated
using (
  auth.uid() = seller_id
  and deployment_id = public.requested_protocol_deployment_id()
  and public.requested_protocol_deployment_is_active()
  and certificate_hash is null
  and onchain_gem_id is null
);

drop policy if exists redemptions_read_own on public.redemption_requests;
create policy redemptions_read_own
on public.redemption_requests for select
to authenticated
using (
  auth.uid() = requester_id
  and deployment_id = public.requested_protocol_deployment_id()
);

drop policy if exists evidence_read_own on public.evidence_files;
create policy evidence_read_own
on public.evidence_files for select
to authenticated
using (
  auth.uid() = owner_id
  and deployment_id = public.requested_protocol_deployment_id()
);

drop policy if exists evidence_insert_own on public.evidence_files;
create policy evidence_insert_own
on public.evidence_files for insert
to authenticated
with check (
  auth.uid() = owner_id
  and deployment_id = public.requested_protocol_deployment_id()
  and public.requested_protocol_deployment_is_active()
  and (
    (
      submission_id is not null
      and category in ('certificate', 'gem_media')
      and exists (
        select 1
        from public.seller_submissions
        where id = submission_id
          and deployment_id = public.requested_protocol_deployment_id()
          and seller_id = auth.uid()
          and certificate_hash is null
          and onchain_gem_id is null
      )
    )
    or (
      submission_id is null
      and category = 'redemption_document'
    )
  )
);

drop policy if exists evidence_delete_own on public.evidence_files;
create policy evidence_delete_own
on public.evidence_files for delete
to authenticated
using (
  auth.uid() = owner_id
  and deployment_id = public.requested_protocol_deployment_id()
  and public.requested_protocol_deployment_is_active()
  and (
    submission_id is null
    or exists (
      select 1
      from public.seller_submissions
      where id = submission_id
        and deployment_id = public.requested_protocol_deployment_id()
        and seller_id = auth.uid()
        and certificate_hash is null
        and onchain_gem_id is null
    )
  )
);

drop policy if exists gift_cards_read_own on public.gift_cards;
create policy gift_cards_read_own
on public.gift_cards for select
to authenticated
using (
  sender_id = auth.uid()
  and deployment_id = public.requested_protocol_deployment_id()
);

drop policy if exists valuations_read_own_submission on public.valuations;
create policy valuations_read_own_submission
on public.valuations for select
to authenticated
using (
  deployment_id = public.requested_protocol_deployment_id()
  and exists (
    select 1 from public.seller_submissions s
    where s.id = valuations.submission_id
      and s.deployment_id = public.requested_protocol_deployment_id()
      and s.seller_id = auth.uid()
  )
);

drop policy if exists gift_card_events_parties_read on public.gift_card_events;
create policy gift_card_events_parties_read
on public.gift_card_events for select
to authenticated
using (
  deployment_id = public.requested_protocol_deployment_id()
  and (
    sender_id = auth.uid()
    or public.current_user_has_verified_email(recipient_email)
  )
);

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own
on public.notifications for select
to authenticated
using (
  profile_id = (select auth.uid())
  and deployment_id = public.requested_protocol_deployment_id()
);

drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read
on public.notifications for update
to authenticated
using (
  profile_id = (select auth.uid())
  and deployment_id = public.requested_protocol_deployment_id()
  and public.requested_protocol_deployment_is_active()
)
with check (
  profile_id = (select auth.uid())
  and deployment_id = public.requested_protocol_deployment_id()
  and public.requested_protocol_deployment_is_active()
);

-- Keep derived event rows on exactly the same deployment as their gift even if
-- the active suite changes while a transaction is in flight.
create or replace function public.record_gift_card_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_type text;
  event_time timestamptz;
  event_hash text;
begin
  if tg_op = 'INSERT' then
    next_type := 'prepared';
    event_time := new.created_at;
  elsif new.status = 'active' and old.status = 'pending_escrow' then
    next_type := 'escrowed';
    event_time := coalesce(new.escrowed_at, new.updated_at);
    event_hash := new.escrow_tx_hash;
  elsif new.status = 'claim_pending' and old.status = 'active' then
    next_type := 'claim_submitted';
    event_time := coalesce(new.operation_started_at, new.updated_at);
    event_hash := new.claim_tx_hash;
  elsif new.status = 'claimed' and old.status = 'claim_pending' then
    next_type := 'claimed';
    event_time := coalesce(new.claimed_at, new.updated_at);
    event_hash := new.claim_tx_hash;
  elsif new.status = 'cancel_pending' and old.status in ('pending_escrow', 'active') then
    next_type := 'cancel_submitted';
    event_time := coalesce(new.operation_started_at, new.updated_at);
    event_hash := new.return_tx_hash;
  elsif new.status = 'cancelled' and old.status in ('pending_escrow', 'active', 'cancel_pending') then
    next_type := 'cancelled';
    event_time := coalesce(new.returned_at, new.updated_at);
    event_hash := new.return_tx_hash;
  elsif new.status = 'claim_pending' and new.claim_tx_hash is distinct from old.claim_tx_hash then
    next_type := 'claim_submitted';
    event_time := coalesce(new.operation_started_at, new.updated_at);
    event_hash := new.claim_tx_hash;
  elsif new.status = 'cancel_pending' and new.return_tx_hash is distinct from old.return_tx_hash then
    next_type := 'cancel_submitted';
    event_time := coalesce(new.operation_started_at, new.updated_at);
    event_hash := new.return_tx_hash;
  else
    return new;
  end if;

  insert into public.gift_card_events (
    deployment_id, gift_id, sender_id, recipient_email, token_id, gem_id,
    event_type, occurred_at, transaction_hash
  ) values (
    new.deployment_id, new.id, new.sender_id, new.recipient_email, new.token_id, new.gem_id,
    next_type, event_time, event_hash
  )
  on conflict (gift_id, event_type) do update
    set occurred_at = excluded.occurred_at,
        transaction_hash = coalesce(excluded.transaction_hash, gift_card_events.transaction_hash);
  return new;
end;
$$;

create or replace function public.open_gift_token_ids()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct token_id::text
  from public.gift_cards
  where deployment_id = public.requested_protocol_deployment_id()
    and custody_mode = 'operator_escrow'
    and status in ('pending_escrow', 'active', 'claim_pending', 'cancel_pending');
$$;

create or replace function public.notify_gift_card_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  card public.gift_cards%rowtype;
  who text;
  recipient_wallet text;
  recipient_profile uuid;
begin
  select * into card
  from public.gift_cards
  where id = new.gift_id
    and deployment_id = new.deployment_id;
  if not found then
    return new;
  end if;
  who := coalesce(nullif(card.recipient_name, ''), card.recipient_email);

  if new.event_type = 'escrowed' then
    insert into public.notifications
      (deployment_id, wallet_address, profile_id, kind, title, body, action_path, entity_type, entity_id)
    values
      (new.deployment_id, lower(card.sender_wallet), card.sender_id, 'gift.sent',
       'Your gift card is live',
       format('Gemstone #%s is in escrow for %s.', card.gem_id, who),
       '/profile?tab=gifts', 'gift_card', card.id::text)
    on conflict do nothing;

    select wl.wallet_address, wl.profile_id into recipient_wallet, recipient_profile
    from public.profiles p
    join public.wallet_links wl
      on wl.profile_id = p.id and wl.is_primary and wl.verified_at is not null
    where lower(p.email) = lower(card.recipient_email)
    limit 1;
    if recipient_wallet is not null then
      insert into public.notifications
        (deployment_id, wallet_address, profile_id, kind, title, body, action_path, entity_type, entity_id)
      values
        (new.deployment_id, lower(recipient_wallet), recipient_profile, 'gift.received',
         'You have been sent a gemstone',
         format('A gift card for gemstone #%s is waiting for you.', card.gem_id),
         '/gift', 'gift_card', card.id::text)
      on conflict do nothing;
    end if;
  elsif new.event_type = 'claimed' then
    insert into public.notifications
      (deployment_id, wallet_address, profile_id, kind, title, body, action_path, entity_type, entity_id)
    values
      (new.deployment_id, lower(card.sender_wallet), card.sender_id, 'gift.claimed',
       'Your gift was claimed', format('%s claimed gemstone #%s.', who, card.gem_id),
       '/profile?tab=gifts', 'gift_card', card.id::text)
    on conflict do nothing;
  elsif new.event_type = 'cancelled' then
    insert into public.notifications
      (deployment_id, wallet_address, profile_id, kind, title, body, action_path, entity_type, entity_id)
    values
      (new.deployment_id, lower(card.sender_wallet), card.sender_id, 'gift.cancelled',
       'Gift card cancelled',
       format('The gift card for gemstone #%s was cancelled and the token returned to your wallet.', card.gem_id),
       '/profile?tab=gifts', 'gift_card', card.id::text)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- Protect the deployment key from authenticated notification updates.
create or replace function public.notifications_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  new.deployment_id := old.deployment_id;
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

comment on table public.protocol_deployments is
  'Verified protocol-suite manifests. Exactly one deployment is active; archived rows remain queryable by service-role audit tooling.';
comment on column public.seller_submissions.deployment_id is
  'Protocol suite that owns the on-chain gem id. Prevents ids from colliding after a redeploy.';

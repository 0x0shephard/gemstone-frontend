-- Durable gift mutation recovery and privacy-scoped lifecycle history.

alter table public.gift_cards
  add column if not exists client_request_id uuid,
  add column if not exists operation_started_at timestamptz,
  add column if not exists operation_nonce bigint,
  add column if not exists cancel_from_status text;

alter table public.gift_cards
  drop constraint if exists gift_cards_operation_nonce_check;
alter table public.gift_cards
  add constraint gift_cards_operation_nonce_check
  check (operation_nonce is null or operation_nonce >= 0);

create unique index if not exists gift_cards_sender_request
  on public.gift_cards (sender_id, client_request_id)
  where client_request_id is not null;

alter table public.gift_cards
  drop constraint if exists gift_cards_status_check;
alter table public.gift_cards
  add constraint gift_cards_status_check
  check (
    status in (
      'pending_escrow',
      'active',
      'claim_pending',
      'claimed',
      'cancel_pending',
      'cancelled'
    )
  );

alter table public.gift_cards
  drop constraint if exists gift_cards_cancel_from_status_check;
alter table public.gift_cards
  add constraint gift_cards_cancel_from_status_check
  check (cancel_from_status is null or cancel_from_status in ('pending_escrow', 'active'));

drop index if exists public.gift_cards_one_open_per_token;
create unique index if not exists gift_cards_one_open_per_token
  on public.gift_cards (token_id)
  where status in ('pending_escrow', 'active', 'claim_pending', 'cancel_pending');

create table if not exists public.gift_card_events (
  id bigint generated always as identity primary key,
  gift_id uuid not null references public.gift_cards(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  token_id numeric(78, 0) not null,
  gem_id numeric(78, 0),
  event_type text not null
    check (event_type in ('prepared', 'escrowed', 'claim_submitted', 'claimed', 'cancel_submitted', 'cancelled')),
  occurred_at timestamptz not null,
  transaction_hash text
    check (transaction_hash is null or transaction_hash ~* '^0x[0-9a-f]{64}$'),
  unique (gift_id, event_type)
);

create index if not exists gift_card_events_sender_time
  on public.gift_card_events (sender_id, occurred_at desc);
create index if not exists gift_card_events_recipient_time
  on public.gift_card_events (lower(recipient_email), occurred_at desc);

alter table public.gift_card_events enable row level security;

create or replace function public.current_user_has_verified_email(expected_email text)
returns boolean
language sql
stable
security definer
set search_path = auth, public
as $$
  select exists (
    select 1
    from auth.users
    where id = auth.uid()
      and email_confirmed_at is not null
      and lower(email) = lower(expected_email)
  );
$$;

revoke all on function public.current_user_has_verified_email(text) from public;
grant execute on function public.current_user_has_verified_email(text) to authenticated;

drop policy if exists gift_card_events_parties_read on public.gift_card_events;
create policy gift_card_events_parties_read
on public.gift_card_events for select
to authenticated
using (
  sender_id = auth.uid()
  or public.current_user_has_verified_email(recipient_email)
);

grant select on public.gift_card_events to authenticated;

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
    gift_id, sender_id, recipient_email, token_id, gem_id,
    event_type, occurred_at, transaction_hash
  ) values (
    new.id, new.sender_id, new.recipient_email, new.token_id, new.gem_id,
    next_type, event_time, event_hash
  )
  on conflict (gift_id, event_type) do update
    set occurred_at = excluded.occurred_at,
        transaction_hash = coalesce(excluded.transaction_hash, gift_card_events.transaction_hash);
  return new;
end;
$$;

drop trigger if exists gift_cards_record_event on public.gift_cards;
create trigger gift_cards_record_event
after insert or update on public.gift_cards
for each row execute function public.record_gift_card_event();

-- Backfill one row for every lifecycle timestamp that is already known.
insert into public.gift_card_events (
  gift_id, sender_id, recipient_email, token_id, gem_id,
  event_type, occurred_at, transaction_hash
)
select id, sender_id, recipient_email, token_id, gem_id, 'prepared', created_at, null
from public.gift_cards
on conflict (gift_id, event_type) do nothing;

insert into public.gift_card_events (
  gift_id, sender_id, recipient_email, token_id, gem_id,
  event_type, occurred_at, transaction_hash
)
select id, sender_id, recipient_email, token_id, gem_id, 'escrowed', escrowed_at, escrow_tx_hash
from public.gift_cards where escrowed_at is not null
on conflict (gift_id, event_type) do nothing;

insert into public.gift_card_events (
  gift_id, sender_id, recipient_email, token_id, gem_id,
  event_type, occurred_at, transaction_hash
)
select id, sender_id, recipient_email, token_id, gem_id, 'claimed', claimed_at, claim_tx_hash
from public.gift_cards where claimed_at is not null
on conflict (gift_id, event_type) do nothing;

insert into public.gift_card_events (
  gift_id, sender_id, recipient_email, token_id, gem_id,
  event_type, occurred_at, transaction_hash
)
select id, sender_id, recipient_email, token_id, gem_id, 'cancelled',
       coalesce(returned_at, updated_at), return_tx_hash
from public.gift_cards where status = 'cancelled'
on conflict (gift_id, event_type) do nothing;

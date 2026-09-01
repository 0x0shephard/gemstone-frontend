-- Move new gift cards from revocable approvals to operator-held NFT escrow.
-- Existing approval-backed cards remain valid until claimed or cancelled.

alter table public.gift_cards
  add column if not exists custody_mode text not null default 'approval',
  add column if not exists escrow_wallet text,
  add column if not exists escrowed_at timestamptz,
  add column if not exists escrow_tx_hash text,
  add column if not exists returned_at timestamptz,
  add column if not exists return_tx_hash text;

alter table public.gift_cards
  drop constraint if exists gift_cards_status_check;
alter table public.gift_cards
  add constraint gift_cards_status_check
  check (status in ('pending_escrow', 'active', 'claimed', 'cancelled'));

alter table public.gift_cards
  drop constraint if exists gift_cards_custody_mode_check;
alter table public.gift_cards
  add constraint gift_cards_custody_mode_check
  check (custody_mode in ('approval', 'operator_escrow'));

alter table public.gift_cards
  drop constraint if exists gift_cards_escrow_wallet_check;
alter table public.gift_cards
  add constraint gift_cards_escrow_wallet_check
  check (escrow_wallet is null or escrow_wallet ~* '^0x[0-9a-f]{40}$');

alter table public.gift_cards
  drop constraint if exists gift_cards_operator_escrow_fields;
alter table public.gift_cards
  add constraint gift_cards_operator_escrow_fields
  check (custody_mode <> 'operator_escrow' or escrow_wallet is not null);

drop index if exists public.gift_cards_one_active_per_token;
create unique index if not exists gift_cards_one_open_per_token
  on public.gift_cards (token_id)
  where status in ('pending_escrow', 'active');

comment on table public.gift_cards is
  'Email-bound gemstone gifts. New cards transfer the NFT into operator escrow before becoming claimable; legacy approval-backed cards remain supported.';
comment on column public.gift_cards.custody_mode is
  'approval for legacy cards; operator_escrow for cards whose NFT is held by escrow_wallet.';

-- Temporary marketplace identity labels. Only an account name and its verified
-- primary wallet are exposed; email addresses and profile ids never leave the
-- database. The input ceiling keeps this public helper a bounded marketplace
-- lookup rather than a profile-directory endpoint.
create or replace function public.marketplace_profile_names(wallet_addresses text[])
returns table(wallet_address text, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select lower(link.wallet_address), trim(profile.full_name)
  from public.wallet_links as link
  join public.profiles as profile on profile.id = link.profile_id
  where cardinality(wallet_addresses) between 1 and 100
    and link.is_primary
    and link.verified_at is not null
    and nullif(trim(profile.full_name), '') is not null
    and lower(link.wallet_address) = any (
      select lower(requested.address)
      from unnest(wallet_addresses) as requested(address)
    );
$$;

revoke all on function public.marketplace_profile_names(text[]) from public;
grant execute on function public.marketplace_profile_names(text[]) to anon, authenticated;

comment on function public.marketplace_profile_names(text[]) is
  'Temporary public marketplace labels for verified primary wallets. Returns names only; never emails or profile ids.';

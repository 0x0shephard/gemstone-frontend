-- Promotional claims: a public code (FIRST100) that gives each new collector
-- one token from a pool the operator wallet holds.
--
-- Nothing here moves a token. A claim becomes an ordinary operator-escrow gift
-- card bound to the claimant's verified email, and `v1-gift-claim` performs the
-- transfer with all of its existing reconciliation. These tables only decide
-- who gets which token, once.
--
-- Service role only: the Edge Function `v1-promo` is the sole reader and writer.

create table if not exists public.promo_campaigns (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null default public.current_protocol_deployment_id()
    references public.protocol_deployments(id),
  -- Stored upper-case; the code is public, so it is kept in clear.
  code text not null check (code ~ '^[A-Z0-9]{4,32}$'),
  title text not null check (char_length(title) between 1 and 120),
  message text check (message is null or char_length(message) <= 500),
  max_claims integer not null check (max_claims > 0),
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deployment_id, code)
);

create table if not exists public.promo_pool (
  deployment_id text not null references public.protocol_deployments(id),
  token_id numeric not null check (token_id > 0),
  campaign_id uuid not null references public.promo_campaigns(id),
  gem_id numeric,
  -- Where the token came from. Becomes the gift card's sender wallet, so a
  -- cancelled promotional card returns the stone there, not to the operator.
  deposited_from text not null check (deposited_from ~* '^0x[0-9a-f]{40}$'),
  added_by uuid not null references public.profiles(id),
  added_at timestamptz not null default now(),
  primary key (deployment_id, token_id)
);
create index if not exists promo_pool_campaign on public.promo_pool (campaign_id, added_at);

create table if not exists public.promo_claims (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null references public.protocol_deployments(id),
  campaign_id uuid not null references public.promo_campaigns(id),
  profile_id uuid not null references public.profiles(id),
  email text not null check (position('@' in email) > 1),
  wallet text not null check (wallet ~ '^0x[0-9a-f]{40}$'),
  token_id numeric not null,
  gift_card_id uuid not null references public.gift_cards(id),
  created_at timestamptz not null default now(),
  -- One stone per account, per email and per wallet, for each campaign.
  unique (campaign_id, profile_id),
  unique (campaign_id, email),
  unique (campaign_id, wallet),
  unique (deployment_id, token_id)
);

alter table public.promo_campaigns enable row level security;
alter table public.promo_pool enable row level security;
alter table public.promo_claims enable row level security;
revoke all on public.promo_campaigns from anon, authenticated;
revoke all on public.promo_pool from anon, authenticated;
revoke all on public.promo_claims from anon, authenticated;

drop trigger if exists promo_campaigns_set_updated_at on public.promo_campaigns;
create trigger promo_campaigns_set_updated_at
  before update on public.promo_campaigns
  for each row execute function public.set_updated_at();

/*
 * Assigns one pooled token to a claimant, or returns the one already assigned.
 *
 * Locks the campaign row, so concurrent claims are served one at a time and the
 * cap cannot be overrun. The new gift card is `active` in operator escrow from
 * the start: the token is already in the operator wallet, which `v1-promo`
 * checks before it adds a token to the pool and again before the transfer.
 *
 * Errors are raised with stable messages `v1-promo` maps to user text.
 */
create or replace function public.assign_promo_token(
  p_deployment_id text,
  p_campaign_id uuid,
  p_profile_id uuid,
  p_email text,
  p_wallet text,
  p_code_hash text,
  p_escrow_wallet text
) returns table (gift_card_id uuid, token_id numeric, gem_id numeric, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.promo_campaigns%rowtype;
  v_existing public.promo_claims%rowtype;
  v_claimed integer;
  v_pool public.promo_pool%rowtype;
  v_card uuid;
  v_email text := lower(trim(p_email));
  v_wallet text := lower(trim(p_wallet));
begin
  select * into v_campaign from public.promo_campaigns
    where id = p_campaign_id and deployment_id = p_deployment_id
    for update;
  if not found then
    raise exception 'promo_not_found';
  end if;

  select * into v_existing from public.promo_claims
    where campaign_id = p_campaign_id and profile_id = p_profile_id;
  if found then
    return query select v_existing.gift_card_id, v_existing.token_id,
      (select p.gem_id from public.promo_pool p
        where p.deployment_id = p_deployment_id and p.token_id = v_existing.token_id),
      false;
    return;
  end if;

  if not v_campaign.active then
    raise exception 'promo_closed';
  end if;
  if exists (
    select 1 from public.promo_claims c
    where c.campaign_id = p_campaign_id and (c.email = v_email or c.wallet = v_wallet)
  ) then
    raise exception 'promo_already_claimed';
  end if;

  select count(*) into v_claimed from public.promo_claims c where c.campaign_id = p_campaign_id;
  if v_claimed >= v_campaign.max_claims then
    raise exception 'promo_sold_out';
  end if;

  select p.* into v_pool from public.promo_pool p
    where p.campaign_id = p_campaign_id
      and p.deployment_id = p_deployment_id
      and not exists (
        select 1 from public.promo_claims c
        where c.deployment_id = p.deployment_id and c.token_id = p.token_id
      )
      and not exists (
        select 1 from public.gift_cards g
        where g.deployment_id = p.deployment_id
          and g.token_id = p.token_id
          and g.status in ('pending_escrow', 'active', 'claim_pending', 'cancel_pending')
      )
    order by p.added_at, p.token_id
    limit 1;
  if not found then
    raise exception 'promo_sold_out';
  end if;

  insert into public.gift_cards (
    deployment_id, sender_id, sender_wallet, token_id, gem_id, code_hash,
    recipient_email, message, template, status, custody_mode, escrow_wallet,
    escrowed_at, expires_at
  ) values (
    p_deployment_id, v_campaign.created_by, lower(v_pool.deposited_from), v_pool.token_id,
    v_pool.gem_id, p_code_hash, v_email, v_campaign.message, 'classic', 'active',
    'operator_escrow', lower(p_escrow_wallet), now(), now() + interval '365 days'
  ) returning id into v_card;

  insert into public.promo_claims (
    deployment_id, campaign_id, profile_id, email, wallet, token_id, gift_card_id
  ) values (
    p_deployment_id, p_campaign_id, p_profile_id, v_email, v_wallet, v_pool.token_id, v_card
  );

  return query select v_card, v_pool.token_id, v_pool.gem_id, true;
end;
$$;

revoke all on function public.assign_promo_token(text, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.assign_promo_token(text, uuid, uuid, text, text, text, text)
  to service_role;

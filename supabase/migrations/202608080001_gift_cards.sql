-- Gift cards: a claimable handover of a minted token.
--
-- The sender never gives the token up. They approve the protocol operator for
-- one token id, and that approval is spent exactly once — when the recipient
-- proves their email and links a wallet. Until then the token sits in the
-- sender's wallet, earns nothing for anyone else, and can be sold or swapped
-- out from under the card (which cancels it, correctly: the approval dies with
-- the transfer).
--
-- An unclaimed card is not a forfeiture. At `expires_at` it simply stops being
-- claimable and the sender keeps the stone.
--
-- One thing this design cannot do, and it is worth stating where the schema
-- lives: ERC-721 `approve` may only be called by the owner or an
-- approved-for-all operator. A per-token approval does not grant that, so the
-- operator cannot revoke its own approval when a card expires. The stale
-- approval survives until the *sender* clears it. `expires_at` is enforced on
-- the claim path, so an expired card is inert, but the on-chain permission
-- outlives it and only the owner can withdraw it.

create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),

  sender_id uuid not null references public.profiles(id) on delete cascade,
  -- Recorded at creation. The operator transfers *from* this address, and a
  -- token that has since moved makes the card unclaimable rather than making it
  -- transfer someone else's property.
  sender_wallet text not null,
  token_id numeric(78, 0) not null,
  gem_id numeric(78, 0),

  -- The claim code is never stored, only its SHA-256. A database leak therefore
  -- yields no claimable cards. The consequence is that a sender who loses the
  -- printed card cannot re-display it — they cancel and issue a new one.
  code_hash text not null unique,

  -- Required, not optional. Without it the code is a bearer instrument and
  -- anyone who photographs the printed card takes the gemstone. Binding the
  -- claim to an address the sender chose is the whole security model.
  recipient_email text not null,
  recipient_name text,
  message text,
  template text not null default 'classic',

  status text not null default 'active'
    check (status in ('active', 'claimed', 'cancelled')),

  claimed_by uuid references public.profiles(id),
  claimed_wallet text,
  claimed_at timestamptz,
  claim_tx_hash text,

  -- Expiry is a timestamp, not a status. The claim path compares against
  -- `now()` directly, so a card is unclaimable the instant it lapses whether or
  -- not any sweep has run. Nothing needs to run.
  expires_at timestamptz not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint gift_cards_sender_wallet_check
    check (sender_wallet ~* '^0x[0-9a-f]{40}$'),
  constraint gift_cards_claimed_wallet_check
    check (claimed_wallet is null or claimed_wallet ~* '^0x[0-9a-f]{40}$'),
  constraint gift_cards_email_check
    check (position('@' in recipient_email) > 1),
  constraint gift_cards_message_length
    check (message is null or char_length(message) <= 500),
  constraint gift_cards_claimed_fields
    check (
      status <> 'claimed'
      or (claimed_by is not null and claimed_wallet is not null and claimed_at is not null)
    )
);

comment on table public.gift_cards is
  'Claimable token handovers. The sender keeps custody and grants the operator a single-token approval; an unclaimed card expires without forfeiture.';

-- At most one live card per token. Two active cards would race for one
-- approval, and the loser would fail at the worst possible moment: after the
-- recipient had signed up and connected a wallet.
create unique index if not exists gift_cards_one_active_per_token
  on public.gift_cards (token_id)
  where status = 'active';

create index if not exists gift_cards_sender
  on public.gift_cards (sender_id, created_at desc);

create index if not exists gift_cards_recipient_email
  on public.gift_cards (lower(recipient_email))
  where status = 'active';

drop trigger if exists gift_cards_set_updated_at on public.gift_cards;
create trigger gift_cards_set_updated_at
before update on public.gift_cards
for each row execute function public.set_updated_at();

alter table public.gift_cards enable row level security;

-- Senders read their own cards so the portfolio can list them. Everything that
-- writes — creation, claiming, cancellation — runs in an edge function on the
-- service role, because each one has a precondition the database cannot check
-- on its own (an on-chain approval, a matching session email, a transfer).
drop policy if exists gift_cards_read_own on public.gift_cards;
create policy gift_cards_read_own
on public.gift_cards for select
to authenticated
using (sender_id = auth.uid());

-- Move the auction round counter off `seller_submissions` and key it by gem id.
--
-- The sweep that uses this enumerates candidates from the chain, because a
-- database-driven sweep can only ever see gems that arrived through the seller
-- flow. Gem 4 was registered by a seeding script with no submission row, so it
-- was invisible to the previous version and sat with an auction that had expired
-- twelve days earlier — the exact failure the sweep exists to prevent, made
-- invisible by the sweep looking in the wrong place.
--
-- Keying on `gem_id` means every gem the registry knows about can be counted,
-- however it got there.

create table if not exists public.auction_cycles (
  gem_id numeric(78, 0) primary key,
  rounds integer not null default 0 check (rounds >= 0),
  last_opened_at timestamptz,
  -- Set when the round ceiling is reached. The sweep then leaves the stone
  -- alone: `GemRegistry` has no unlist, so ending a listing is a human decision.
  exhausted_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.auction_cycles is
  'Re-auction bookkeeping, keyed by on-chain gem id. The contract keeps one Auction per gem and overwrites it, so rounds cannot be counted on-chain.';

-- Carry across what the submission-keyed columns had recorded.
insert into public.auction_cycles (gem_id, rounds, last_opened_at, exhausted_at)
select
  onchain_gem_id,
  coalesce(auction_rounds, 0),
  auction_last_opened_at,
  auction_exhausted_at
from public.seller_submissions
where onchain_gem_id is not null
on conflict (gem_id) do nothing;

alter table public.seller_submissions
  drop column if exists auction_rounds,
  drop column if exists auction_last_opened_at,
  drop column if exists auction_exhausted_at;

drop index if exists seller_submissions_auction_sweep;

alter table public.auction_cycles enable row level security;

-- No client access. The sweep runs on the service role; nothing in the browser
-- reads or writes this.

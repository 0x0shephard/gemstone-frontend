-- Rolling 24-hour re-auctions for stones that draw no bid.
--
-- A gemstone becomes a token only by being won at auction, so a stone that
-- attracts no bidder would otherwise sit inert with an expired auction and no
-- route forward. It is instead re-opened each day, up to a ceiling, after which
-- an operator decides whether to keep going or return the stone.
--
-- The count lives here because the contract has no notion of rounds: it stores
-- one `Auction` per gem and overwrites it. That makes this table the bookkeeping
-- rather than the truth — an operator calling `createDailyAuction` directly with
-- the lister key will not advance it.

alter table public.seller_submissions
  add column if not exists auction_rounds integer not null default 0
    check (auction_rounds >= 0),
  add column if not exists auction_last_opened_at timestamptz,
  -- Set when the ceiling is reached. The sweep stops touching the stone and
  -- leaves the decision to a human rather than cancelling on its own.
  add column if not exists auction_exhausted_at timestamptz;

comment on column public.seller_submissions.auction_rounds is
  'Completed 24-hour auction rounds. Advanced by v1-auction-refresh only.';
comment on column public.seller_submissions.auction_exhausted_at is
  'When the round ceiling was reached. The stone stays Listed on-chain; GemRegistry has no unlist.';

-- The sweep looks for registered stones that are still unminted.
create index if not exists seller_submissions_auction_sweep
  on public.seller_submissions (auction_last_opened_at)
  where onchain_gem_id is not null and auction_exhausted_at is null;

-- Backfill: stones already listed have had their first auction opened.
update public.seller_submissions
set auction_rounds = 1,
    auction_last_opened_at = coalesce(activated_at, updated_at)
where onchain_gem_id is not null
  and sale_mode = 'auction'
  and auction_rounds = 0;

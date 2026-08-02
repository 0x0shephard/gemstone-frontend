-- Observed bid demand, feeding the market preference multipliers.
--
-- Raw observations are stored rather than pre-aggregated counts: the aggregation
-- window is a query parameter, and a valuation embeds the snapshot it used in its
-- own commitment, so there is nothing to reconstruct from a rollup later.

create table if not exists public.demand_bids (
  id uuid primary key default gen_random_uuid(),
  gem_id numeric(78, 0) not null,
  bidder text not null,
  tx_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  -- Block timestamp, not ingest time: re-running the job must not move a bid.
  observed_at timestamptz not null,
  -- Denormalised at ingest from the gem's attributes at the time of the bid.
  -- Null where the attribute is unknown; the engine treats a missing criterion
  -- as neutral rather than as zero demand.
  shape text,
  color text,
  color_grade text,
  ingested_at timestamptz not null default now(),
  -- Idempotency. The scanner deliberately re-reads recent blocks, so the same
  -- log must be insertable repeatedly without inflating demand.
  unique (tx_hash, log_index)
);

create index if not exists demand_bids_observed_at_idx on public.demand_bids (observed_at desc);
create index if not exists demand_bids_gem_bidder_idx on public.demand_bids (gem_id, bidder);

-- Single-row scan cursor. The check constraint makes a second row impossible.
create table if not exists public.demand_scan_state (
  id boolean primary key default true check (id),
  scanned_through_block bigint not null,
  updated_at timestamptz not null default now()
);

comment on table public.demand_bids is
  'Observed BidPlaced events with the gem attributes they voted for. Source data for market preference multipliers.';
comment on column public.demand_bids.observed_at is
  'Block timestamp of the bid, so aggregation windows are chain time rather than ingest time.';
comment on table public.demand_scan_state is
  'How far the demand ingest has scanned. Single row by construction.';

-- Service-role only. RLS on with no policies denies anon and authenticated
-- outright; the service role used by Edge Functions bypasses RLS.
alter table public.demand_bids enable row level security;
alter table public.demand_scan_state enable row level security;

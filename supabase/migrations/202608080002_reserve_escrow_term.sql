-- The date a stone's reserve escrow ends, recorded when it enters custody.
--
-- Gift cards need this. A voucher over a tokenised gemstone cannot outlive the
-- escrow that backs the gemstone, so the claim window is the escrow term rather
-- than a duration the protocol picked for itself — which is also why the
-- previous fixed 200-day constant had to go.
--
-- It belongs on the custody record because that is where it is actually known:
-- the escrow term is a property of the arrangement the custodian enters into
-- with the seller for that particular stone, not something derivable from
-- anything on chain. `ReserveManager` has no time dimension at all — no term,
-- no maturity, not a single timestamp — so there is nowhere else this could be
-- read from.

alter table public.seller_submissions
  add column if not exists reserve_escrow_ends_at timestamptz;

comment on column public.seller_submissions.reserve_escrow_ends_at is
  'End of the reserve escrow term for this stone. Upper bound on any gift card issued over its token.';

/*
 * `NOT VALID` on purpose. Stones already in custody predate this column and
 * have no recorded term; validating against them would fail the migration and
 * inventing a date for them would be worse than leaving it blank. New intake is
 * held to the rule, and the old rows stay visibly incomplete until a custodian
 * fills them in — `v1-gift-create` refuses rather than guessing, so the gap
 * shows up as a refusal to issue a card, not as a card with a wrong date.
 */
alter table public.seller_submissions
  drop constraint if exists seller_submissions_escrow_term_recorded;
alter table public.seller_submissions
  add constraint seller_submissions_escrow_term_recorded
  check (custody_received_at is null or reserve_escrow_ends_at is not null)
  not valid;

-- `v1-gift-create` reaches this row by on-chain gem id, not by submission id.
create index if not exists seller_submissions_escrow_by_gem
  on public.seller_submissions (onchain_gem_id)
  where reserve_escrow_ends_at is not null;

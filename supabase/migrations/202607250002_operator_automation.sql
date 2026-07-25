-- Resumable Sepolia seller activation state.

alter table public.seller_submissions
  add column if not exists valuation_method text,
  add column if not exists approved_valuation_usd numeric(78,0),
  add column if not exists valuation_hash text,
  add column if not exists valuation_matrix_hash text,
  add column if not exists valuation_canonical_payload text,
  add column if not exists valuation_nonce text,
  add column if not exists activation_state text not null default 'pending',
  add column if not exists activation_started_at timestamptz,
  add column if not exists activation_error text,
  add column if not exists activation_attempts integer not null default 0,
  add column if not exists registration_tx_hash text,
  add column if not exists custody_tx_hash text,
  add column if not exists valuation_tx_hash text,
  add column if not exists listing_tx_hash text,
  add column if not exists auction_tx_hash text;

alter table public.seller_submissions
  drop constraint if exists seller_submissions_activation_state_check,
  drop constraint if exists seller_submissions_valuation_hash_check,
  drop constraint if exists seller_submissions_valuation_matrix_hash_check;

alter table public.seller_submissions
  add constraint seller_submissions_activation_state_check
    check (
      activation_state in (
        'pending',
        'prepared',
        'registering',
        'registered',
        'custody_confirmed',
        'verified',
        'listed',
        'auction_created',
        'failed'
      )
    ),
  add constraint seller_submissions_valuation_hash_check
    check (valuation_hash is null or valuation_hash ~ '^0x[0-9a-f]{64}$'),
  add constraint seller_submissions_valuation_matrix_hash_check
    check (valuation_matrix_hash is null or valuation_matrix_hash ~ '^0x[0-9a-f]{64}$');

create index if not exists seller_submissions_activation_queue
  on public.seller_submissions(activation_state, updated_at)
  where onchain_gem_id is null or status <> 'registered';

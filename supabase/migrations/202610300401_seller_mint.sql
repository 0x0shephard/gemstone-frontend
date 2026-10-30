-- Seller route "mint to my wallet" (docs/seller-mint-design.md).
--
-- A seller chooses at submission between the daily primary auction and having
-- the NFT minted straight to their verified wallet (GemRegistry SellerMint mode,
-- PrimarySaleAuction.mintToSeller). An unbid auction may switch to minting,
-- never back.

alter table public.seller_submissions
  add column if not exists mint_tx_hash text,
  add column if not exists minted_token_id numeric(78,0),
  add column if not exists sale_mode_switched_at timestamptz;

alter table public.seller_submissions
  drop constraint if exists seller_submissions_sale_mode_check,
  drop constraint if exists seller_submissions_activation_state_check,
  drop constraint if exists seller_submissions_mint_tx_hash_check;

alter table public.seller_submissions
  add constraint seller_submissions_sale_mode_check
    check (sale_mode in ('buy_now', 'auction', 'seller_mint')),
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
        -- Listed in SellerMint mode, but a reserve shortfall or mint fee is due,
        -- so the seller must pay and sign mintToSeller themselves.
        'awaiting_seller_mint',
        'minted',
        'failed'
      )
    ),
  add constraint seller_submissions_mint_tx_hash_check
    check (mint_tx_hash is null or mint_tx_hash ~ '^0x[0-9a-f]{64}$');

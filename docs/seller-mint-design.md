# Seller choice: auction or mint to own wallet

Agreed with Jon on 2026-10-30. **Built 2026-10-30** on branch `feat/seller-mint` in both repos;
not yet deployed. See "Implementation notes" at the end for what differs from the plan below.

## Goal

After the usual submission, lab appraisal, bank receipt and admin activation, a seller chooses one
of two routes:

1. **Auction** (today's flow). The stone goes to the daily primary auction. The winner pays and
   the NFT is minted to them.
2. **Mint to my wallet** (new). The NFT is minted straight to the seller's verified wallet. From
   there they can do everything an owner does today: list it on the marketplace, gift it, transfer
   it, or sell it on OpenSea.

## Decisions

- **Mint fee:** add a fee in USD that the Safe can set, starting at **0**, so minting is free at
  launch. It is paid to Treasury, or to the platform recipient, in ETH or USDC.
- **Who mints:** it happens **automatically at activation**. The operator `0x89c2` mints to the
  seller's registered wallet. If a non-zero reserve shortfall or mint fee is ever due, the seller
  must pay it first (see "Seller-paid path").
- **Switching:** **auction → mint only.** If an auction round ends with no bids, the seller may
  switch to mint-to-wallet. Once minted, a stone never goes back to primary auction.

## Why the contracts must change

- Only PrimarySaleAuction (PSA) holds `MINTER_ROLE` on DGENFT and GemRegistry, and it only mints to
  a buyer, through `buyNow` or `settleAuction`.
- A seller "buying" their own stone through `buyNow` would pay the full price, 20% of which goes
  to the 8/6/4/2 split.
- `GemRegistry.PrimarySaleMode` is `None / BuyNow / Auction`. ABI decoding rejects any enum value
  the deployed code doesn't know, so GemRegistry must learn the new mode too.

## Contract changes (UUPS upgrades; append-only storage)

### GemRegistry

- Append the enum value `PrimarySaleMode.SellerMint`. It must come last, to keep stored values
  valid.
- `listGem` accepts it unchanged; it already rejects only `None`.
- Add `setPrimarySaleMode(gemId, newMode)` for the switch, callable by `LISTER_ROLE`. It is allowed
  only Auction → SellerMint, only while `status == Listed`, and only while
  `primaryAuctionActive[gemId] == false`, i.e. no live auction or bid. It emits an event.
  - The sweep `v1-auction-refresh` must not reopen an auction once the mode is SellerMint.

### PrimarySaleAuction

- New state, appended: `uint256 sellerMintFeeUsd` (default 0), with a setter guarded by
  `DEFAULT_ADMIN_ROLE` (the Safe) and an event.
- New `mintToSeller(uint256 gemId, address paymentAsset, uint256 amount) payable returns (uint256 tokenId)`.
  1. Require `registry.canMint(gemId)` and `primarySaleMode(gemId) == SellerMint`.
  2. Require `requireSequencerUp()`, but only when a quote is needed (shortfall + fee > 0).
  3. Compute `reserveUsd = reserveManager.shortfallUsd(gemId, gem.priceUsd)` and
     `dueUsd = reserveUsd + sellerMintFeeUsd`.
  4. **Who may call:**
     - If `dueUsd == 0`, callable by `LISTER_ROLE` (the operator, automatic) or by `gem.seller`.
     - If `dueUsd > 0`, only `gem.seller`, paying `dueUsd` in ETH or USDC. Refund any surplus, the
       same way `buyNow` does.
  5. Fund the reserve with the reserve part through `_fundReserve`, then `requireFunded`. Send the
     fee part to Treasury or the platform recipient (push-or-credit, like settlement).
  6. `tokenId = nft.mintTo(gem.seller, gemId, gem.metadataURI)`, then
     `registry.markMinted(gemId, tokenId)`, then `reserveManager.syncProjectedLiabilityUsd(gemId, gem.priceUsd)`.
  7. Emit `SellerMinted(gemId, tokenId, seller, paymentAsset, paidAmount, feeUsd, reserveUsd)`.
  - It **always mints to `gem.seller`**, never to `msg.sender`, so an operator call can't divert
    the NFT.
- `bid`, `createDailyAuction` and `buyNow` must reject SellerMint gems. They already check the mode
  or auction state; add explicit tests.

### Process (same as the settlement fix, contracts PR #9)

- Run `forge inspect storageLayout` before and after (append-only), add regression tests, and
  `forge test` on Foundry 1.8.5.
- Rehearse on an Arbitrum fork (`anvil --hardfork prague`), impersonating the Safe.
- Deploy the implementations with the `IMPLEMENTATION_ONLY=true` upgrade scripts from `0x89c2`.
  It holds about 0.00058 ETH, and the deploys cost about 0.0002 ETH.
- The Safe batches `upgradeToAndCall(impl, 0x)` for GemRegistry and PSA. Then record upgrade
  manifests in `../gemstone/deployments/`, or the canary fails.
- The upgrade order matters only if PSA reads the new enum before GemRegistry knows it, so batch
  GemRegistry first.

## Backend (`supabase/functions`)

- `seller_submissions.sale_mode` already exists; activation currently forces auction. Accept
  `'auction' | 'seller_mint'` at submit time (`v1-seller-submit`) and store it. Add a migration if
  the column has a check constraint.
- **Activation** (`_shared/sellerAutomation.ts`):
  - For `seller_mint`: `listGem(..., SellerMint)`, then the operator calls
    `mintToSeller(gemId, 0x0, 0)` when `shortfallUsd + sellerMintFeeUsd == 0`.
  - Otherwise, mark the submission `awaiting_seller_mint`, so the seller pays from the UI.
  - Record the mint tx at broadcast, with the same lifecycle callback as registration.
- **Switch:** a new action, for example `v1-seller-submit` `switch_to_mint`. It is allowed when the
  last auction round ended unbid and nothing is live. It calls `setPrimarySaleMode`, then mints as
  above.
- **`v1-auction-refresh`:** skip gems in SellerMint mode.
- Bump the ABIs in `src/contracts/generated` with the contracts check.

## Frontend

- **Seller submission form:** the route choice, Auction or "Mint to my wallet", explaining that
  minting gives the NFT directly with no sale proceeds.
- **Seller page:** a status for each route. For a minted stone, link to the owner actions.
- **Gem page and auctions:** a SellerMint gem never shows "Place bid" (see `src/lib/gemActions.ts`).
- **"Mint to my wallet" button**, only when a fee or reserve is due: the seller pays and signs
  `mintToSeller`.
- **Switch button** on an unbid ended auction: "Mint to my wallet instead".

## Out of scope / notes

- The 80/8/6/4/2 split applies only to sales, so a self-mint pays no split; the platform earns the
  2% secondary fee on later marketplace sales.
- OpenSea sales skip the platform fee, which is already the case for any minted token.

## Implementation notes (2026-10-30)

- **Contracts** (`gemstone` `feat/seller-mint`):
  - `GemRegistry`: `PrimarySaleMode.SellerMint` (appended) and `setPrimarySaleMode`.
  - `PrimarySaleAuction`: `sellerMintFeeUsd` (slot 7), `setSellerMintFeeUsd`, `mintToSeller`, and
    `bid` now rejects any gem not in Auction mode.
  - Added beyond the plan: a view `sellerMintDueUsd(gemId) -> (reserveUsd, feeUsd)`, because the
    edge functions have no ReserveManager address and the seller UI needs the amount due.
  - The fee is paid to `treasury.platformRecipient()` push-or-credit (`pendingRefunds` fallback,
    claimable with `claimRefund`).
  - Storage layouts checked append-only. Tests: `test/SellerMint.t.sol` (15),
    `test/UpgradeScripts.t.sol`, and the fork rehearsal `test/fork/SellerMintArbitrumFork.t.sol`
    (skipped unless `ARBITRUM_FORK_URL` is set).
  - New `script/UpgradeGemRegistry.s.sol` (`GEM_REGISTRY_ADDRESS`, `IMPLEMENTATION_ONLY=true`).
- **Backend:**
  - Migration `202610300401_seller_mint.sql`: `sale_mode` `seller_mint`, activation states
    `awaiting_seller_mint` and `minted`, and columns `mint_tx_hash`, `minted_token_id`,
    `sale_mode_switched_at`.
  - `v1-seller-submit` accepts `saleMode: 'seller_mint'` (anything else is an auction, never buy-now)
    and adds actions `switch_to_mint` and `sync_mint`.
  - Activation mints through the operator when `sellerMintDueUsd` is zero, otherwise it sets
    `awaiting_seller_mint`.
  - **Switch rule** (`_shared/sellerMintRules.ts`): no current leader, and either the current round
    has ended or the sweep has reopened at least one round. Order: cancel the stale round, set the
    mode, mint.
  - `v1-auction-refresh` already skips gems whose on-chain mode is not Auction, so it needed no
    change.
- **Frontend:**
  - The seller form offers the route choice.
  - The submissions list shows the route, an "In your wallet · Token #N" badge, and "Mint to my
    wallet instead" for an activated auction stone.
  - `SellerMintPayment` handles the seller-paid case.
  - Gem pages need no change: a seller-mint stone has no auction record, so "Place bid" never shows.

### Deploy order

1. Contracts, in order:
   1. Merge the contracts PR.
   2. From `0x89c2`, deploy the implementations with
      `IMPLEMENTATION_ONLY=true ... --broadcast --slow --skip-simulation`, using
      `UpgradeGemRegistry` and `UpgradePrimarySaleAuction`.
   3. In the Safe, batch the two `upgradeToAndCall(impl, 0x)` calls, **GemRegistry first**.
   4. Add the upgrade manifests to `../gemstone/deployments/` (the canary checks them).
2. `npx supabase db push --linked`, for the migration.
3. Merge the frontend PR (Netlify), then `npx supabase functions deploy`. The site must not offer
   the choice before the contracts know `SellerMint`, or activation would revert at `listGem`.

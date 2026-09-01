# Workflow map — browser to contracts

Every path from a user action to a contract call, and who signs each one.

Two signers exist and they never overlap:

| Signer                           | Holds                                                                        | Signs                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Trader wallet** (browser)      | Their own funds and NFTs                                                     | Everything on the trading side                                           |
| **Operator key** (Edge Function) | `COMPLIANCE`, `LISTER`, `CUSTODIAN`, `VERIFIER`, and the primary-sale lister | Everything on the supply side: registration, custody, valuation, listing |

Grading labs hold **neither**. They authenticate with Supabase credentials only;
the operator key relays their decision. `SEPOLIA_OPERATOR_PRIVATE_KEY` is
server-only and must never be prefixed `VITE_`.

---

## A. Supply side — seller submits, lab approves, protocol lists

### A1. Submission (no chain writes)

```
SellerPage.tsx
  └─ submitSellerGem()                        services/offchain/workflows.ts
       ├─ storage.upload → certificates/<uid>/…      private bucket, RLS on uid prefix
       ├─ storage.upload → gem-media/<uid>/…         private bucket, max 10 files
       ├─ insert evidence_files                      sha256 + mime recorded per file
       └─ invoke v1-seller-submit  action=create
            └─ insert seller_submissions
                 status = 'submitted'
                 verification_provider = 'pending'
                 metadata_uri = data:… (provisional, no image)
```

The inline `data:` document is a placeholder. It is never what reaches the chain.

### A2. Routing (no chain writes)

```
SellerPage → invoke v1-seller-submit  action=verify
  ├─ requireLinkedWallet()             SIWE-verified primary wallet, else 403
  ├─ assertEvidenceComplete()          ≥1 certificate and ≥1 image, ≤10 images
  └─ verificationMode(admin)           protocol_settings.verification_mode
       ├─ 'lab'  → status = 'awaiting_custody'   ← stops here, nothing on-chain
       └─ 'auto' → status = 'approved' → A4 with allowAutomaticValuation: true

  sale_mode is forced to 'auction' server-side, never read from the request.
```

**Auction is the only route to a token.** A gemstone cannot be minted directly:
`PrimarySaleAuction.buyNow` reverts `WrongPrimarySaleMode` unless the gem was
listed in BuyNow mode, and nothing lists that way any more. So the restriction
is enforced on-chain, not merely hidden in the UI. Settlement mints to
`auction.highestBidder` and pays `gem.seller` — the seller receives proceeds,
never the token.

Only an `org_admin` of an `admin`-kind organisation can change the mode, through
`v1-verification-settings`. `protocol_settings` has no client write policy, so a
seller cannot route their own stone around a lab.

### A2b. Custody intake — physical, off-chain

```
VerifyPage custody queue → v1-custody-confirm
  ├─ canConfirmCustody()   kind = 'admin', or role = 'custodian'
  ├─ records custody_received_at / _by / _organization,
  │           custody_condition_notes, custody_matches_declared,
  │           reserve_escrow_ends_at        ← required, must be in the future
  └─ status = 'awaiting_custody' → 'awaiting_grading'
```

This is the step that makes grading meaningful. Without it the protocol asserted
custody the instant a lab approved, with nobody having received anything — and
the lab was assessing the seller's photographs, which is exactly what separating
claimed attributes from graded ones exists to prevent.

Note there are **two distinct things** called custody. This is the physical
event. `GemRegistry.confirmCustody` in A4 is a mechanical state transition that
cannot be moved out of the atomic sequence, because `verifyGem` requires
`CustodyConfirmed` and `registerGem` cannot run before grading. The on-chain call
attests to what was recorded here.

A divergence between the received stone and the seller's declaration is flagged
rather than rejected: the grader's own measurements are authoritative, and the
note is surfaced to them.

**`reserve_escrow_ends_at` is captured here and nowhere else.** It is a property
of the escrow arrangement this custodian entered into for this stone, and
nothing on chain records it — `ReserveManager` holds balances and coverage
ratios with no timestamps whatever. It later bounds the claim window of any gift
card issued over the stone's token (D2). The constraint enforcing it is
`NOT VALID`, so stones that entered custody before this existed keep a null and
simply cannot carry a gift card until a custodian records one.

### A3. Grading — the lab's decision

```
VerifyPage.tsx  (route /verify, absent from nav, 404 for non-members)
  ├─ loadQueue()        → v1-verification-queue
  │     requireVerifier()          verifier_members row, else 404 (not 403)
  │     QUEUE_COLUMNS              seller identity stripped at the query
  │     matrixOptions()            dropdowns served from the pricing matrix
  │
  ├─ loadSubmission(id) → v1-verification-queue { submissionId }
  │     signed URLs, 900s, minted on the service role
  │     eligibleAsPrimaryImage     true only for gem_media
  │
  ├─ previewPrice()     → v1-verification-grade { preview: true }
  │     currentDemand() → calculateValuation() → full breakdown, no writes
  │
  └─ submitGrading(id, grades, primaryImageId)
        → v1-verification-grade → A4
```

The preview and the commit are the **same code path**; the figure a grader
approves cannot drift from the figure recorded.

`rejectSubmission()` is the other exit: `status = 'rejected'` with a reason, no
chain write and nothing pinned. It exists only because grading now precedes
registration — after A4 there is no undo.

### A4. Activation — the only on-chain sequence on this side

`_shared/sellerAutomation.ts`, operator-signed, under a 5-minute
`protocol_operator_leases` lease so two submissions cannot drive the key at once.

```
prepareSellerSubmission()
  1. resolvePrimaryImage()      download the lab's chosen gem_media from private storage
  2. publishImage()             pin → verify byte-identical from ≥2 gateways
  3. publishMetadata()          build doc with image: ipfs://<imageCid> → pin → verify
  4. createCommitment()         keccak256(RFC-8785 canonical JSON) over metadataUri +
                                certificate digests + attributes + 32-byte nonce

activateSellerSubmission()      each step idempotent, tx hash persisted
  5. GemRegistry.setSellerApproval(seller, true)      skipped if already approved
  6. GemRegistry.registerGem(seller, custodian, metadataURI, certificateHash)
        → GemRegistered(gemId)                        metadataURI is now permanent
  7. GemRegistry.confirmCustody(gemId)                Registered → CustodyConfirmed
  8. GemRegistry.verifyGem(gemId, valuationHash, valuationMatrixHash, approvedValuationUsd)
                                                      CustodyConfirmed → Verified
  9. GemRegistry.listGem(gemId, priceUsd, mode)       priceUsd MUST equal the approved
                                                      valuation or the invariant breaks
 10. PrimarySaleAuction.createDailyAuction(gemId, floorUsd)   auction sale mode only
```

**Ordering is forced, not stylistic.** Steps 2 → 3 → 6 are a dependency chain:
the image CID lives inside the metadata document, and `registerGem` writes that
document's URI to a field with **no setter** in either `GemRegistry` or `DGENFT`.
Nothing downstream can correct a mistake made here — which is why every publish
is read back from independent gateways before the next step depends on it, and
why a failure aborts instead of degrading.

`allowAutomaticValuation` stays **false** on the lab path. If the graded figure
were somehow missing, activation fails loudly rather than committing the
test-only `$500/ct` fallback to `approvedValuationUsd`.

Failure at any step sets `activation_state = 'failed'` and is resumable:
`recoverRegisteredGem()` re-derives `gemId` from `GemRegistered` logs by matching
`metadataURI` + `certificateHash`, so a retry never registers a second gem.

### A5. Unsold stones re-auction daily

```
v1-auction-refresh          scheduled, gated by x-auction-refresh-secret
  candidates enumerated from the registry, not from seller_submissions
  for each Listed, unminted, auction-mode gem:
    auction still running          → skip
    expired with a winning bid     → settleAuction, minting to the winner
    expired with no bid            → cancelAuction → createDailyAuction
    auction_rounds >= 60           → mark auction_exhausted_at, leave for an operator
```

`_createAuction` rejects a gem whose previous auction still `exists` and is
unsettled, and a no-bid auction is never settled — so re-opening requires
`cancelAuction` first. Both calls are `LISTER_ROLE`, held by the operator key.

Settlement is driven by the sweep too. It is permissionless and
self-terminating: `settleAuction` either mints to the winner, or refunds them
and marks the auction settled via `_refundHighestBid`. Either outcome leaves a
state the sweep can act on, so a won auction never waits on someone noticing it.
Cancelling one instead would refund the winner and destroy the sale, which is why
the winning-bid branch settles rather than cancels.

Candidates come from the **chain**. A database-driven sweep only sees gems that
arrived through the seller flow, and gem 4 — registered by a seeding script with
no submission row — sat with an auction twelve days expired while the sweep
reported success. Probing the registry covers every gem it knows about, however
it got there.

The round count lives in `auction_cycles`, keyed by gem id, because the contract
stores one `Auction` per gem and overwrites it. That makes the table bookkeeping
rather than truth: a direct `createDailyAuction` with the lister key will not
advance it. A gem with no row counts as round zero rather than being skipped.

**There is no unlist.** After the ceiling, `cancelAuction` clears the auction but
the gem stays `Listed` forever — `GemRegistry` has no withdraw path and the only
exit is being minted. Exhaustion is therefore a flag for a human, not an
automatic cancellation.

### A6. People are told what is waiting on them

```
v1-notify-sweep             scheduled hourly, gated by x-notify-sweep-secret
  event pass    Marketplace  OfferCreated  → owner: you have an offer (24h)
                             OfferAccepted → close the watch
                SwapEscrow   OfferCreated  → owner: a swap is proposed
                             OfferAccepted → close the watch
                Auction      BidPlaced     → earlier bidders: you were outbid
                             AuctionSettled          → winner: you won
                             AuctionSettlementRefunded → bidder: claim it back
  deadline pass offer expired, still active → bidder: claim your refund
                swap expired, still active  → proposer: your NFT is in escrow
```

Two passes because the two failure modes are different shapes. The event pass
reads what happened. The deadline pass reads what is about to stop being
possible, and a log scan cannot find that — the event that matters is the absence
of one. Positions are written to `notification_watch` with their expiry as they
open, so the expiry check is a dated query rather than a rescan of all history.

**The swap case is the one that strands most.** `SwapEscrow.createOffer`
transfers the proposer's NFT into escrow. Once the offer expires `acceptOffer`
reverts, and only `cancelOffer` — callable by the proposer alone — returns it.
Nothing on chain does this automatically, and before this sweep nothing told them
either, so an unaccepted swap parked a token in a contract indefinitely.

Deduplication lives in a unique index on
`(wallet_address, kind, entity_type, entity_id)` rather than in the sweep. The
sweep re-derives state every hour and will see the same open offer every time; a
crashed and rerun pass must not double-send either.

Notifications are addressed to a **wallet**, not a profile. Tokens reach people
with no account — a gift, a plain transfer — and those holders still have
deadlines. `v1-siwe-verify` backfills `profile_id` when a wallet is linked, so
someone who signs up in order to act on an emailed offer does not arrive at an
empty list. A wallet nobody has linked still gets a row; it simply cannot be
emailed.

Redemption is on this list because it is the one flow that **cannot** finish on
its own. `RedemptionManager.confirmRedemption` checks `msg.sender != gem.custodian`
— an exact address, not a role — so a request stays open until that one wallet
acts. Before the sweep covered it nothing told the custodian anything, and the
redeem portal reported "Custodian fulfillment, 60%" indefinitely; the 60 is a
constant, not a measurement. The custodian's action lives in Portfolio →
Redemption, which now lists a request to **both** parties rather than only the
owner.

**Not covered.** A listing selling (`Purchased`) notifies nobody: the sale pays
the seller automatically, so nothing is stranded, and the event carries only the
buyer. Reserve shortfalls and seller submission status changes are also silent —
they are database transitions rather than chain events, so they belong at the
point of change rather than in a sweep.

---

## B. Pricing engine

```
_shared/valuationMatrix.ts   versioned data; keccak256 of its canonical JSON is
                             valuationMatrixHash, recorded on-chain
_shared/valuationMath.ts     pure integer math, no npm: imports, unit-tested
_shared/valuation.ts         Deno: commitment + demand snapshot
_shared/demand.ts            BidPlaced ingest, keyed by txHash+logIndex (idempotent)
v1-demand-refresh            scheduled, gated by x-demand-refresh-secret
```

```
BaseGemValue = Pvariety × Mcarat × Mclarity × Mtreatment

for k in {shape, colour, colourGrade}:
    share_i = (bids_i + 1) / (Σ bids + N_k)          Laplace: unseen ⇒ M ≈ 1.0
    M_k     = clamp(1 + 0.5 · (share_i − 1/N_k)·N_k,  0.75, 1.30)

NFTPrice = BaseGemValue × clamp(Π M_k, 0.70, 1.50)     then clamped to $100–$250,000
```

All multipliers are parts-per-million `bigint`; prices are 18-decimal USD
`bigint`. No floats anywhere — a float rounding difference between two runs would
produce a different `valuationHash` for identical inputs and make the commitment
unreproducible.

Inputs outside the matrix (unpriced variety, carat outside 0.5–5.0) **refuse**.
The engine never extrapolates into a field that has no setter.

Each valuation stores the demand counts it priced against, not just the result,
so it stays re-derivable after bid counts move. `valuations` is append-only.

Until `v1-demand-refresh` has run, every market multiplier resolves to a neutral
1.0 and stones price on base value alone. That is correct behaviour, not a fault.

---

## C. Trading side — trader-signed

Every one of these passes through `runContractTransaction()`
([transactionPipeline.ts](../src/services/chain/transactionPipeline.ts)), which
enforces four gates before it will simulate anything:

1. a Supabase session,
2. a connected wallet,
3. a `wallet_links` row that is primary **and** SIWE-verified for that exact address,
4. `switchChain` to the configured chain.

Then: balance check → ERC-20 `approve` / ERC-721 `setApprovalForAll` if needed →
`simulateContract` → `writeContract` → receipt. A revert is decoded to a named
custom error rather than surfaced raw.

| User action                     | Page        | Contract call                                             |
| ------------------------------- | ----------- | --------------------------------------------------------- |
| Buy at fixed price              | GemDetail   | `PrimarySaleAuction.buyNow`                               |
| Bid                             | Auctions    | `PrimarySaleAuction.bid`                                  |
| Settle a closed lot             | Auctions    | `PrimarySaleAuction.settleAuction`                        |
| Claim an outbid refund          | Profile     | `PrimarySaleAuction.claimRefund`                          |
| List an owned gem               | Profile     | `Marketplace.list` (needs `DGENFT` approval)              |
| Buy a listing                   | Marketplace | `Marketplace.buy`                                         |
| Make / accept / cancel an offer | GemDetail   | `Marketplace.createOffer` / `acceptOffer` / `cancelOffer` |
| Swap two gems                   | Swaps       | `SwapEscrow.createOffer` / `acceptOffer`                  |
| Fund the reserve                | GemDetail   | `ReserveManager.fundNative` / `fundToken`                 |
| Request redemption              | Redeem      | `RedemptionManager.requestRedemption`                     |
| Cancel a redemption             | Redeem      | `RedemptionManager.cancelRedemption`                      |
| Send a token to an address      | Portfolio   | `DGENFT.safeTransferFrom`                                 |
| Issue a gift card               | Portfolio   | `DGENFT.safeTransferFrom` (sender → gift escrow)          |
| Cancel an escrowed gift         | Portfolio   | Operator returns the token to the sender                  |
| Clear a legacy gift approval    | Portfolio   | `DGENFT.approve(0x0, tokenId)`                            |

**Solvency couples all of these.** `requireSolvent()` guards seven entry points —
`buyNow`, `bid`, `Marketplace.buy`/`createOffer`/`acceptOffer`,
`SwapEscrow.acceptOffer`, and `requestRedemption`. Aggregate liability derives
from registry prices, so an upward revaluation can drop coverage below the floor
and freeze all seven protocol-wide. That is the reason `revalueGem` (Layer 3,
unbuilt) must check coverage and revert **itself** rather than succeed.

---

## D. What the marketplace shows

The Token Marketplace is a **catalogue of every token that exists**, not a
for-sale list. Every token was minted by winning an auction, so every one has an
owner, and hiding the unlisted majority would hide the collection.

```
getListings() → readGem() per gem
    owner        = DGENFT.ownerOf(tokenId)     absent ⇒ burned by redemption, dropped
    listingSeller = Marketplace.listings(tokenId)   present ⇒ escrowed and for sale
```

Unminted stones never appear here — they are in the auction, which is the only
way to mint. The card action follows the token's real state rather than a URL
parameter:

| State                      | Action                                 |
| -------------------------- | -------------------------------------- |
| Escrowed in a live listing | **Buy now** at the listed price        |
| Held, not listed           | **Make an offer** · **Propose a swap** |
| Owned by the viewer        | **Manage**                             |

"Offer" rather than "bid" deliberately: bidding already means auction bidding on
an unminted stone, and the Portfolio separates **Minting Bids** from **Token
Bids** for the same reason.

---

## D2. Gift cards — a claimable handover

A new gift card is an email-bound handover backed by **operator-held escrow**.
The token leaves the sender only after the server has created a recoverable
pending record, and the card becomes claimable only after an on-chain read
proves that the operator wallet holds it. Cards issued before this change keep
their approval-backed claim path so existing printed cards still work.

```
Portfolio → Owned Tokens → Send Token
  ├─ Send to wallet address ──► DGENFT.safeTransferFrom          immediate, final
  └─ Make a gift card
       ├─ v1-gift-create {action:'prepare'}
       │                   verifies ownership / lock / term and stores a pending row
       │  DGENFT.safeTransferFrom(sender, operator, tokenId)
       ├─ v1-gift-create {action:'confirm'}
       │                   proves operator custody and activates the card
       └─ card renders to SVG → print · PNG · SVG · link · WhatsApp

QR ──► /gift/:code
  v1-gift-claim {action:'inspect'}   public: shows the gift before asking for anything
  1. email OTP or Google  ─ session email must equal recipient_email
  2. connect + SIWE       ─ writes wallet_links
  3. v1-gift-claim {action:'claim'}
        re-reads escrow owner / lock, takes the row conditionally,
        then operator DGENFT.safeTransferFrom(escrow → recipient)
```

**The claim window is the stone's reserve escrow term, and forfeits nothing.**
`v1-gift-create` reads `seller_submissions.reserve_escrow_ends_at` for the gem
behind the token and uses it verbatim as `expires_at`. A voucher over a
tokenised gemstone cannot outlive the escrow backing the gemstone, and a
duration the protocol picked for itself would be exactly the kind of unilateral
term a voucher may not carry.

`ReserveManager` has **no time dimension at all** — no term, no maturity, not one
timestamp — so this date cannot be read from the chain. It is recorded by the
custodian at intake, alongside the arrival record, because that is where it is
actually known. A gem with no recorded term cannot carry a gift card:
`v1-gift-create` returns 409 rather than inventing an expiry, since a wrong date
on a printed voucher is the one thing that cannot be corrected afterwards.

A lapsed card is not claimable. The sender cancels it from Portfolio → **Gift
Cards**, which returns the escrowed stone to the verified sender wallet.

**Legacy approvals outlive their cards, and only the owner can clear them.** ERC-721
`approve` may be called only by the token's owner or an approved-for-all
operator. A per-token approval grants neither, so the gift operator cannot
revoke its own permission when a card expires or is cancelled. `expires_at` is
enforced on the claim path, so an expired card is inert — but the on-chain
permission stays until the sender withdraws it. Portfolio → **Gift Cards**
surfaces exactly those cases and offers **Revoke approval**.

For new cards, sale and swap are impossible while the operator owns the token.
The claim path still re-reads custody and the redemption lock rather than
trusting what was true at issue time:

| Event                         | Effect on the card                                      |
| ----------------------------- | ------------------------------------------------------- |
| Escrow custody is missing     | Claim refuses                                           |
| Redemption locks the token    | Claim refuses                                           |
| Sender cancels the card       | Claim stops and the operator returns the token          |

**Why the email is mandatory.** Without it the printed code is a bearer
instrument: whoever photographs the card takes the gemstone, including anyone
who handles it in the post. Binding the claim to an address the sender chose is
the entire security model, and it is why the code is stored hashed — a database
leak yields nothing claimable.


---

## E. Read path

```
contracts ──multicall──► chainService.readGem()      authoritative for current state
    │
    ├─ metadataURI ──► readMetadata()                data: parsed inline
    │                    ipfs:// → configured gateway, then ipfs.io, dweb.link,
    │                             cloudflare-ipfs; memoized, failures evicted
    │                    └─ .image ──► imageUrl() ──► <img> in GemThumb
    │                                  preferred gateway only; on error the
    │                                  generated facet swatch shows through
    │
    └─ events ──► IndexedDB projection               keyed by chainId + manifest hash
                    adaptive block ranges, rescans latest 64,
                    final after 12 confirmations, serves explicitly stale on RPC loss
```

Chain mode never substitutes mock data. A broken manifest shows a blocking
configuration report instead.

---

## F. Where a stone can stop

| State                                    | Meaning                                  | On-chain? | Recoverable                                |
| ---------------------------------------- | ---------------------------------------- | --------- | ------------------------------------------ |
| `submitted`                              | Uploaded, not yet routed                 | no        | seller re-runs `action=verify`             |
| `awaiting_custody`                       | Accepted; stone not yet received         | no        | a custodian records its arrival            |
| `awaiting_grading`                       | In the vault, in the lab queue           | no        | a grader approves or rejects               |
| `rejected`                               | Lab refused it, reason recorded          | no        | nothing to unwind                          |
| `approved` + `activation_state='failed'` | Valuation durable, chain work incomplete | partly    | retry resumes from the last completed step |
| `registered`                             | Listed, or auction live                  | yes       | terminal                                   |

The valuation is written to Postgres **before** activation runs. A chain failure
after grading loses gas, never the grading.

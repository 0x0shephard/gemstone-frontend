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
  │           custody_condition_notes, custody_matches_declared
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
    expired with a winning bid     → skip, settlement mints to the winner
    expired with no bid            → cancelAuction → createDailyAuction
    auction_rounds >= 60           → mark auction_exhausted_at, leave for an operator
```

`_createAuction` rejects a gem whose previous auction still `exists` and is
unsettled, and a no-bid auction is never settled — so re-opening requires
`cancelAuction` first. Both calls are `LISTER_ROLE`, held by the operator key.

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

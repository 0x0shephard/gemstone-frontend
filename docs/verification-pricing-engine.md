# Verification and Pricing Engine — Implementation Plan

Status: Layer 2 (pricing engine) and the demand pipeline are built and tested.
Layers 1 and 3 are still plan.
Source of pricing rules: `Gemstone Valuation Matrix` (client document).

## Locked decisions

| Decision              | Choice                                                                  |
| --------------------- | ----------------------------------------------------------------------- |
| Demand-driven pricing | Applied on-chain, via a new revaluation path                            |
| Revaluation scope     | Pre-mint only — `Verified` and `Listed`. Minted gems are never repriced |
| Who signs on-chain    | Labs approve off-chain with no wallet; the platform operator relays     |
| Approval flow         | A single lab approval fires the transaction immediately                 |
| Demand signal         | Bids only, with Laplace smoothing for cold start                        |

## Constraints this has to respect

Verified against the deployed contracts, not assumed.

1. **`verifyGem` is one-shot.** It requires `status == CustodyConfirmed` and sets `Verified`
   ([GemRegistry.sol:158](../../gemstone/src/GemRegistry.sol)). A second call reverts `InvalidStatus`.
   Repricing therefore needs a new function; it cannot reuse this one.

2. **`GemRegistry` is UUPS upgradeable** (`_authorizeUpgrade`, `UPGRADER_ROLE`). The new function
   ships as an in-place implementation upgrade. Proxy addresses, the deployment manifest, `.env` and
   the projection cache key all stay valid.

3. **`listGem` enforces `priceUsd == approvedValuationUsd` exactly.** Revaluing a `Listed` gem must
   update `gem.priceUsd` in the same call or that invariant silently breaks.

4. **Solvency is the dangerous coupling.** `syncProjectedLiabilityUsd` derives liability from the
   price, `minimumCoverageBps` initialises to exactly 100%, and `requireSolvent()` guards seven
   entry points — `PrimarySaleAuction.buyNow`/`bid`, `Marketplace.buy`/`createOffer`/`acceptOffer`,
   `SwapEscrow.acceptOffer` and `RedemptionManager.requestRedemption`. An upward revaluation raises
   aggregate liabilities and can drop coverage below the floor, freezing all seven protocol-wide.
   **`revalueGem` must therefore check coverage and revert itself**, rather than succeeding and
   taking the protocol down. This is audit finding C-01/L-05; revaluation is its trigger.

5. **Reserve reference is the registry price.** Repricing changes reserve requirements. Restricting
   revaluation to pre-mint keeps that confined to unsold inventory the platform still owns.

---

## Layer 1 — Verifier access and portal

### Access model

Labs never touch a wallet. They authenticate with Supabase credentials and work entirely off-chain;
the operator key holds `VERIFIER_ROLE` and submits. New tables:

```
verifier_organizations (id, name, kind: 'lab' | 'admin', active, created_at)
verifier_members       (profile_id, organization_id, role: 'grader' | 'org_admin', active)
```

RLS: the verification queue and evidence are readable only by active members. This is a separate
axis from the existing `wallet_links` trader gating in
[transactionPipeline.ts](../src/services/chain/transactionPipeline.ts) — a lab is not a trader and
must not need a linked wallet.

### What labs must not see

Graders see the stone and its evidence, never the seller. No name, email, wallet address or KYC
record reaches the queue. That is both PII hygiene and a conflict-of-interest control, and it is
enforced by the column selection in the Edge Function rather than by the UI hiding fields.

### Portal

Route `/verify`, outside the public navigation, behind a role gate that returns 404 rather than a
login prompt for non-members.

- **Queue** — submissions at `custody_confirmed`, oldest first, with age and stone summary.
- **Detail** — seller-claimed attributes shown read-only and clearly labelled as _claimed_, beside
  private evidence (certificates, images) fetched through the existing
  `v1-private-file-url` signed-URL function.
- **Grading form** — the lab enters the _authoritative_ graded values: variety, carat, clarity,
  treatment, shape, colour, colour grade. These are stored separately from the seller's claims and
  are what the engine prices. Divergence between claimed and graded is highlighted, and a large
  divergence is worth surfacing to admin review later.
- **Live price preview** — the engine runs as the grader types, showing the full breakdown: base
  per carat, each multiplier, the market multipliers with their demand shares, and the final figure.
  No hidden arithmetic; the grader approves a number they can see derived.
- **Submit** — fires the on-chain transaction immediately (per the locked decision).

### Note on single-lab approval

The chosen flow means one lab account can write a permanent valuation with no second pair of eyes.
That is your call and the plan implements it, but three cheap mitigations belong in the build
because the write is irreversible:

- every grading action is audit-logged with organization, member and full input payload;
- a per-organization daily valuation cap, so a compromised account has a bounded blast radius;
- a bounded change per revaluation (see below), so repricing cannot swing arbitrarily far.

---

## Layer 2 — Pricing engine

### Module layout

Follows the existing split so the arithmetic is unit-testable outside Deno, as
`mvpPricingMath.ts` is split from `mvpPricing.ts`:

```
_shared/valuationMatrix.ts   versioned matrix data; canonical JSON, hashable
_shared/valuationMath.ts     pure computation, no npm: imports, fully tested
_shared/valuation.ts         Deno: matrix hash, commitment, demand snapshot
```

### Integer math only

Every multiplier is fixed-point (parts per million); base prices are 18-decimal USD `bigint`. No
floats anywhere in the path. A float rounding difference between two runs would produce a different
`valuationHash` for the same inputs and make the commitment unreproducible.

### Matrix versioning

`valuationMatrixHash` is already an on-chain field committing to "the exact pricing matrix/version
used". The matrix becomes a canonical JSON document hashed with `keccak256`. Editing a base price or
a delta produces a new version and a new hash; previously valued gems keep the hash of the matrix
they were priced under, so any historical valuation stays reproducible.

### Formula

```
BaseGemValue = Pvariety × Mcarat × Mclarity × Mtreatment

for each variable criterion k in {shape, colour, colourGrade}:
    N_k     = number of choices for k (colour count is variety-dependent)
    share_i = (bids_i + α) / (Σ bids + α · N_k)        α = 1  (Laplace)
    avg     = 1 / N_k
    M_k     = clamp(1 + Δ_k · (share_i − avg) / avg,  lo_k, hi_k)

NFTPrice = BaseGemValue × clamp(Π M_k, loTotal, hiTotal)
```

Laplace smoothing is what fixes cold start: with no observations, `share ≈ avg`, so `M ≈ 1.0`. The
literal formula would instead drive an unseen shape to `1 − Δ` purely for being new.

The clamps are not in the source document and are needed — unbounded, a single dominant colour among
ten gives `M = 5.5`. Confirmed: per-criterion `0.75–1.30`, product `0.70–1.50`.

### Demand snapshots

`valuationHash` commits to the decision, so the decision must be reproducible. Every valuation
stores the demand counts it used, not just the resulting multiplier. Without that, a valuation
cannot be re-derived once bid counts move.

### Refuse rather than extrapolate

If an input falls outside the matrix — an unpriced variety, a carat weight beyond the table — the
engine **fails and blocks the valuation**. It never guesses. The output is written to a field with no
setter, so an out-of-range guess is permanent.

---

## Layer 3 — On-chain write path

### First valuation — no contract change

Existing `verifyGem(gemId, valuationHash, valuationMatrixHash, approvedValuationUsd)` on the
`CustodyConfirmed → Verified` transition. The whole of Phase 1 ships without touching contracts.

### Revaluation — UUPS upgrade

```solidity
function revalueGem(
    uint256 gemId,
    bytes32 valuationHash_,
    bytes32 valuationMatrixHash_,
    uint256 approvedValuationUsd_
) external whenNotPaused onlyRole(Roles.VERIFIER_ROLE)
```

Guards, each tied to a constraint above:

| Guard                                   | Why                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `status` is `Verified` or `Listed` only | Pre-mint scope; never touches an owned NFT                                                             |
| Revert if `primaryAuctionActive[gemId]` | Bids must cover value + shortfall; moving the price mid-auction moves the goalposts under live bidders |
| If `Listed`, update `gem.priceUsd` too  | Preserves the `listGem` invariant                                                                      |
| Coverage check after liability re-sync  | Revert this call instead of freezing all seven `requireSolvent` sites                                  |
| Bounded change per call, plus cooldown  | Limits blast radius given single-lab approval                                                          |
| Distinct `GemRevalued` event            | Keeps revaluation distinguishable from initial verification in the projection                          |

Tests belong in the sibling repo's Foundry suite: revaluation blocked post-mint, blocked during a
live auction, listing invariant preserved, and a revaluation that would breach coverage reverting
without disturbing other flows.

---

## Data model

```
verifier_organizations, verifier_members                    (above)

seller_submissions
  + graded_attributes      jsonb    lab-authoritative grades, distinct from seller claims
  + graded_by_organization uuid
  + graded_at              timestamptz

valuations                          full audit trail, one row per valuation incl. revaluations
  submission_id, gem_id, matrix_version, matrix_hash,
  inputs_canonical, demand_snapshot, base_value_usd,
  multiplier_breakdown, final_usd,
  canonical_payload, nonce, valuation_hash, tx_hash, superseded_by

demand_snapshots                    reproducibility for market multipliers
  criterion, value, bid_count, window_start, window_end, computed_at
```

`valuations` is append-only. A revaluation inserts a new row and sets `superseded_by` on the
previous one, so the pricing history of a stone is fully reconstructable.

---

## Build sequence

**Phase 1 — no contract change.** Verifier orgs, members and RLS; `/verify` portal with queue,
evidence viewer and grading form; the pricing engine with matrix versioning and tests; first
valuation through existing `verifyGem`. This is most of the value and carries no on-chain risk.

**Phase 2 — contract upgrade.** `revalueGem` with the guard table above, Foundry tests, UUPS upgrade
of `GemRegistry`, then the revaluation UI and the demand recomputation job.

Phase 1 is independently shippable and testable on the current deployment.

---

## Matrix parameters — resolved

All six settled. Recorded in `_shared/valuationMatrix.ts`; changing any of them is a pricing change
that requires a version bump, because the matrix hash is committed on-chain.

| Item                   | Decision                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Tourmaline, Aquamarine | Not being listed. Absent from the matrix; the engine refuses them                                                       |
| 2 ct multiplier        | Table wins: 2.4, not the 2.24 in the worked example (a $279 difference on that stone)                                   |
| Carat range            | 0.5–5.0 ct only; nothing above 5 ct is being listed for now. Linear interpolation between anchors, refusal outside them |
| Delta                  | 0.5 for shape, colour and colour grade alike                                                                            |
| Clamps                 | 0.75–1.30 per criterion, 0.70–1.50 on the product                                                                       |
| Treatment              | Single axis; heat and oil do not stack                                                                                  |

The carat decision **floors as well as caps** — a stone under 0.5 ct is refused for the same reason
as one over 5 ct. If sub-half-carat stones are in scope, the table needs a lower anchor.

## Remaining work

Layer 2 is built and tested. Still outstanding:

- **Layer 1** — verifier organisations, members, RLS, and the `/verify` portal.
- **Layer 3** — `revalueGem` and the `GemRegistry` UUPS upgrade.
  The **demand pipeline** is built: `_shared/demandMath.ts` (pure, tested), `_shared/demand.ts`
  (incremental chain ingest) and the `v1-demand-refresh` scheduled function. Raw observations are
  stored rather than rollups, so the aggregation window stays a query parameter and a valuation
  embeds the exact snapshot it priced against.

Two things it surfaced:

- **Colour grade has no data source.** The seller intake form collects `cut` and `color` but no
  colour grade, so that criterion stays empty until the grading portal records it. Absent
  attributes are skipped rather than counted, so the multiplier is neutral rather than wrong.
- **Bid counting mode is a live choice.** `per-bid` is the literal reading of the source matrix and
  is the default. `per-bidder-per-gem` is implemented alongside it, because a two-party bidding war
  on one lot otherwise dominates a criterion on its own — twelve bids from two bidders count as
  twelve under the literal rule and two under the alternative.

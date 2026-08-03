# Pricing and verification engine — internals

How a graded stone becomes three permanent on-chain values, and why each design
choice is the way it is.

Everything here follows from one constraint. `GemRegistry.verifyGem` writes
`approvedValuationUsd`, `valuationHash`, and `valuationMatrixHash`, and **none of
them has a setter** in `GemRegistry` or `DGENFT`. There is no correction path. So
the engine is built to be reproducible, to refuse rather than guess, and to make
the grader approve a number they can watch being derived.

## Module layout

| File                         | Runtime | Role                                                    |
| ---------------------------- | ------- | ------------------------------------------------------- |
| `_shared/valuationMatrix.ts` | any     | Versioned pricing data. Canonicalised and hashed.       |
| `_shared/valuationMath.ts`   | any     | Pure computation. No `npm:` imports, fully unit-tested. |
| `_shared/valuation.ts`       | Deno    | Matrix hash, commitment, demand snapshot                |
| `_shared/demandMath.ts`      | any     | Bid aggregation, pure                                   |
| `_shared/demand.ts`          | Deno    | Incremental `BidPlaced` ingest                          |

The split exists so the arithmetic that decides a permanent figure runs under
`vitest` on plain Node, without a Deno runtime. `valuationMath.ts` importing
anything `npm:`-prefixed would end that, which is why the Deno-only concerns live
one file up.

---

## 1 · Integer math, everywhere

Multipliers are **parts per million** (`1_000_000` = 1.0). Prices are **18-decimal
USD** `bigint`. Carat weights become **micro-carats**. There is no float anywhere
in the path.

This is not fastidiousness. `valuationHash` is a commitment to a decision, and the
promise it makes is that the decision can be re-derived. Two runs of the same
inputs through IEEE-754 can differ in the last bit depending on evaluation order
or platform; that difference propagates through `keccak256` into a completely
different hash. The commitment would be unverifiable.

Precision is preserved by deferring every division. The base value multiplies four
terms and divides **once**:

```ts
baseValueUsd =
  (basePricePerCaratUsd * USD_DECIMALS * caratPpm * clarityPpm * treatmentPpm) / (PPM * PPM * PPM);
```

Dividing after each multiply would truncate three times and drift by several
dollars on a large stone.

The only float in the whole path is the operator-entered carat weight, immediately
quantised on entry:

```ts
const microCarats = BigInt(Math.round(input.caratWeight * 1e6));
```

After that line everything is exact.

---

## 2 · The matrix, and why it is hashed

```ts
version: 'digital-carat-matrix-v1'

varieties:  emerald $1,000/ct · sapphire $2,000 · ruby $1,500 · peridot $200
caratAnchors: 0.5→0.55  1.0→1.00  2.0→2.40  3.0→4.20  5.0→9.00
clarity:    dcl 0.20 · i3 0.60 · i2 0.70 · i1 0.80 · si2 0.95 · si1 1.05 · vs 1.20 · vvs 1.45
treatment:  heated 0.90 · minor heat 0.97 · unheated 1.20 · oiled 0.95 · no oil 1.15
shapes:     8, from cabochon to diamond cut
delta:      0.5 for shape, colour, and colour grade alike
clamps:     0.75–1.30 per criterion · 0.70–1.50 on the product · $100–$250,000 final
```

`valuationMatrixHash` is `keccak256` over the matrix's canonical JSON, with
`bigint`s stringified so they survive serialisation. It goes on-chain beside the
price.

That hash is what makes a historical valuation resolvable. Change a base price and
the hash changes; a stone priced last month still carries the hash of the matrix
that priced it, so its figure stays explicable. **Any edit to that file is a
pricing change and requires a version bump.**

Two deliberate absences and one deliberate override:

- **Tourmaline and aquamarine are not in the matrix.** They are not being listed.
  The engine refuses them rather than pricing an unlisted variety by accident.
- **Ruby and peridot declare a single colour.** Mathematically inert — with N=1 the
  colour multiplier is always exactly 1.0 — so this asserts nothing about their
  pricing. It exists so the criterion has a domain to validate against.
- **2 ct is 2.40, not 2.24.** The source document's table and its worked example
  disagree. The table wins. That is a $279 difference on the example stone, and
  the test suite records the discrepancy so the choice stays visible instead of
  looking like a bug.

---

## 3 · Carat: interpolate inside, refuse outside

The curve is exponential — 0.55 to 9.0 across a tenfold weight range. Between
anchors the engine interpolates linearly:

```
M = lower + (upper − lower) × (w − w_lower) / (w_upper − w_lower)
```

At 1.5 ct: `1.00 + (2.40 − 1.00) × 0.5 = 1.70`.

Outside the anchors it **refuses**. Extrapolating an exponential compounds error
fast, and the result lands in a field with no setter. Note this floors as well as
caps: 0.4 ct is refused for exactly the same reason as 6 ct. If sub-half-carat
stones come into scope, the table needs a lower anchor — not a relaxed guard.

---

## 4 · Demand multipliers

Three criteria vary with market preference: **shape**, **colour**, **colour grade**.
Each is driven by bid counts.

```
share_i = (bids_i + α) / (Σ bids + α·N)          α = 1
M_k     = clamp(1 + Δ · (share_i − 1/N) / (1/N),  0.75, 1.30)
```

The implementation computes the algebraically identical

```
M_k = 1 + Δ · (share × N − 1)
```

because it avoids dividing by `1/N` and keeps everything in integers.

### Laplace smoothing is load-bearing

With no observations the literal formula gives `share = 0`, so `M = 1 − Δ = 0.5` —
a brand-new shape penalised 50% purely for being new, and clamped to the 0.75
floor. The `α = 1` prior makes an unobserved choice land at `share ≈ 1/N`, so
`M ≈ 1.0`.

This is why a cold system is correct rather than broken. Until `v1-demand-refresh`
ingests any `BidPlaced` events, every market multiplier reads exactly 1.0 and
stones price on base value alone. Expected behaviour, not a failure.

### The clamps are not in the source document

They were added because the unbounded formula is unsafe. With ten sapphire colours
and every bid on one of them, `share = 1`, so `M = 1 + 0.5 × 9 = 5.5`. A single
popular colour would multiply a stone's price five and a half times.

Per-criterion **0.75–1.30**, and their product **0.70–1.50** so three criteria
cannot compound to 2.2×. `clamped: true` is reported per criterion and surfaced in
the grading UI, so a grader can see when a bound is doing work.

### Counting mode

`per-bid` is the literal reading of the source matrix and the default.
`per-bidder-per-gem` is implemented alongside it, because a two-party bidding war
on one lot otherwise dominates a criterion by itself — twelve bids from two bidders
count as twelve under the literal rule and two under the alternative.

### Ingest is idempotent

`v1-demand-refresh` keys observations by transaction hash and log index, so a
replayed block range cannot double count. It stores **raw observations**, not
rollups, which keeps the aggregation window a query parameter rather than a
baked-in decision.

---

## 5 · Assembly

```
BaseGemValue = P_variety × M_carat × M_clarity × M_treatment
Market       = clamp(M_shape × M_colour × M_colourGrade, 0.70, 1.50)
Raw          = BaseGemValue × Market
Price        = clamp(ceil(Raw), $100, $250,000)
```

Rounding is **up**, matching the MVP pricing convention it replaced. The final
clamp reports `priceClamped` so a floored or capped figure is visible rather than
silent — a stone priced at $19.80 that comes back as $100 should look deliberate,
not like a bug.

---

## 6 · Commitment and reproducibility

```ts
createCommitment({
  schemaVersion: 'digital-carat-valuation/v2',
  method: 'matrix-v1',
  matrixVersion,
  submissionId,
  gradedBy,
  gradedAttributes, // exactly what the lab entered
  demandSnapshot, // the counts used, not a reference to them
  approvedValuationUsd,
  breakdown, // every intermediate multiplier
  timestamp,
});
```

Canonicalised per RFC 8785, hashed with `keccak256(UTF8(payload))`, salted with a
random 32-byte nonce. The hash goes on-chain; the payload stays private in
`valuations.canonical_payload`.

**The demand snapshot is embedded, not referenced.** This is the subtle part. Bid
counts move continuously. A valuation that merely recorded "the demand as of
block N" could not be re-derived once the underlying data shifted. Storing the
counts themselves is what makes `valuationHash` a keepable promise.

`valuations` is append-only. A revaluation inserts a new row and sets
`superseded_by` on the previous one, so a stone's full pricing history stays
reconstructable.

---

## 7 · Refusal is a feature

`calculateValuation` throws `ValuationError` on: an unpriced variety, a carat
weight outside the anchors, an unknown clarity or treatment, a shape not in the
matrix, or a colour or colour grade the variety does not declare.

Callers must treat a throw as a hard stop. `v1-verification-grade` maps it to
**HTTP 422** with the message shown to the grader — a stone the matrix cannot
price is a decision for a human, not a server fault to paper over. Nowhere does
any caller substitute a default.

The one place this could have leaked is activation. `prepareSellerSubmission`
takes `allowAutomaticValuation`, and on the lab path it is **false**: a missing
graded valuation raises rather than silently falling back to the test-only
`$500/ct` MVP rule.

### Anti-drift

The grading form is populated by `matrixOptions()`, derived from the same document
that prices the stone. A hardcoded dropdown drifts silently — the grader picks a
value the engine dropped, and the refusal arrives only after they have assessed
the whole stone. A test walks the **full cross product** of advertised options and
asserts every combination prices, so the form cannot offer something the engine
would reject.

---

## 8 · Where it runs

| Moment          | Path                                      | Writes               |
| --------------- | ----------------------------------------- | -------------------- |
| Grader types    | `v1-verification-grade { preview: true }` | nothing              |
| Grader approves | same function, no `preview`               | Postgres, then chain |

Preview and commit are the **same code path**, deliberately. A separate preview
implementation is free to drift from the committing one, and the figure a grader
approves would stop being the figure recorded.

On approval, in order: write `valuations` + `seller_submissions`, audit-log, then
`activateSellerSubmission` → `verifyGem(gemId, valuationHash, valuationMatrixHash,
approvedValuationUsd)`.

The database write happens **first**. If the chain work fails, the valuation is
durable and activation is resumable — the grading is never lost, only gas.

---

## 9 · Not built yet

`verifyGem` is one-shot: it requires `status == CustodyConfirmed` and sets
`Verified`. A second call reverts `InvalidStatus`. Repricing therefore needs a new
function, `revalueGem`, behind a UUPS upgrade of `GemRegistry` — Layer 3 in
[verification-pricing-engine.md](./verification-pricing-engine.md).

The dangerous part is solvency. `syncProjectedLiabilityUsd` derives liability from
price, and `requireSolvent()` guards seven entry points. An upward revaluation
raises aggregate liabilities and can drop coverage below the floor, freezing
`buyNow`, `bid`, `Marketplace.buy`/`createOffer`/`acceptOffer`,
`SwapEscrow.acceptOffer`, and `requestRedemption` protocol-wide. `revalueGem` must
therefore check coverage and **revert itself** rather than succeed and take the
protocol down.

Also outstanding: **colour grade has no seller-side data source.** The intake form
collects `cut` and `color` but no colour grade, so that criterion is empty until
the grading portal records it. Absent attributes are skipped rather than counted
as zero, so the multiplier is neutral rather than wrong.

---

## Verifying any of this

The [pilot pack](../pilot/README.md) has five stones with expected figures
computed by importing this engine, plus four refusal cases. See
[workflows.md](./workflows.md) for where the engine sits in the wider path.

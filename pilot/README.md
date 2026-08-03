# Pilot pack

Five synthetic stones with photographs, certificates, and the exact valuation the
engine should produce for each. Use it to walk the whole path — seller submission,
lab grading, on-chain activation, marketplace display — and check the result
against a number that was computed by the engine itself rather than by hand.

Everything here is generated. The photographs are procedural renders and the
certificates say so on their face. Nothing imitates a real laboratory, and no
real stone, person, or organisation is represented.

```
pilot/
  stones.json                  specs + expected valuations, machine-readable
  media/*.png                  two angles per stone (the grader picks one)
  certificates/*-cert.pdf      mock certificates
  scripts/build-pilot-pack.mjs regenerates all of the above
```

## Before you start

| Requirement            | Check                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations applied     | `verification_mode` row exists in `protocol_settings`                                                                                        |
| Functions deployed     | `v1-seller-submit`, `v1-seller-activate`, `v1-verification-queue`, `v1-verification-grade`, `v1-verification-settings`, `v1-custody-confirm` |
| `IPFS_PINNING_JWT` set | `npx supabase secrets list` — without it every gem registers permanently imageless                                                           |
| Reserve solvent        | `coverageRatioBps()` ≥ `minimumCoverageBps`                                                                                                  |
| Mode is `lab`          | `/verify` shows **Lab review** selected                                                                                                      |
| Two accounts           | a verifier (`verifier_members` row) and a **separate** seller with a SIWE-linked wallet                                                      |
| Custody authority      | that verifier is in an `admin`-kind org, or holds `role = 'custodian'`                                                                       |

The seller and the grader must be different accounts. Grading your own submission
tells you nothing about the access control, and the queue deliberately hides
seller identity from the grader.

Custody and grading may be the same account for a walkthrough, but they are
separate authorities: `canConfirmCustody` is `kind = 'admin'` or
`role = 'custodian'`, while grading needs only an active membership. A pure lab
(`kind = 'lab'`, `role = 'grader'`) never sees the custody queue at all.

## Expected valuations

Recomputed by `build-pilot-pack.mjs` from `_shared/valuationMatrix.ts`, assuming
**no bid observations** — so every market multiplier is exactly 1.0 and the price
is `base × carat × clarity × treatment`.

| Stone               | Graded as                     | Arithmetic                      | Expected         |
| ------------------- | ----------------------------- | ------------------------------- | ---------------- |
| `PILOT-RUBY-01`     | ruby, 1.5 ct, vs, unheated    | 1500 × 1.7 × 1.2 × 1.2          | **$3,672**       |
| `PILOT-SAPPHIRE-02` | sapphire, 2 ct, vvs, unheated | 2000 × 2.4 × 1.45 × 1.2         | **$8,352**       |
| `PILOT-EMERALD-03`  | emerald, 0.5 ct, si1, oiled   | 1000 × 0.55 × 1.05 × 0.95       | **$549**         |
| `PILOT-PERIDOT-04`  | peridot, 5 ct, i1, heated     | 200 × 9.0 × 0.8 × 0.9           | **$1,296**       |
| `PILOT-PERIDOT-05`  | peridot, 0.5 ct, dcl, heated  | 200 × 0.55 × 0.2 × 0.9 = $19.80 | **$100** — floor |

Each one earns its place:

- **RUBY-01** interpolates carat between the 1.0 and 2.0 anchors (1.5 ct → 1.7).
- **SAPPHIRE-02** sits exactly on the 2.0 ct anchor, which the matrix sets to 2.4 —
  deliberately overriding the 2.24 the source document's worked example computes.
  If you see $7,795 instead of $8,352, something reverted to the example.
- **EMERALD-03** and **PERIDOT-04** sit exactly on the carat floor and ceiling.
  Both must price. One step outside must refuse.
- **PERIDOT-05** prices to $19.80 and must come back as $100 with `priceClamped: true`.
  A raw $19.80 means the floor is not being applied.

## Refusal cases

The engine must refuse rather than guess — `approvedValuationUsd` has no setter,
so a guess becomes permanent. Enter these in the grading form; each must produce a
red error and leave the approve button disabled.

| Change to `PILOT-RUBY-01` | Expected refusal                  |
| ------------------------- | --------------------------------- |
| carat 0.25                | outside the priced range 0.5–5 ct |
| carat 6                   | outside the priced range 0.5–5 ct |
| variety tourmaline        | no base price configured          |
| colour blue on a ruby     | not a known colour                |

The last two are only reachable through the API — the form's dropdowns are served
from the matrix, so tourmaline and sapphire colours are not offered on a ruby.
That is the anti-drift property working; to exercise the server guard, call
`v1-verification-grade` directly with `preview: true`.

## Runbook

### 1 · Submit as the seller

Sign in as the **seller** account, connect and SIWE-verify a wallet, then at
`/seller` fill the form from `stones.json` → `stones[].seller`. Upload
`files.certificate` under certificates and **both** `files.media` images under
gemstone media — two so the grader has a real choice of primary image.

Pick the sale mode from `stones[].saleMode`; the pack mixes `buy_now` and
`auction` so both activation branches get exercised.

Submit. The status must read **"Awaiting lab review"**. If it jumps straight to a
gem ID, you are in `auto` mode and the engine is being bypassed.

### 2 · Record custody

Sign in as a member who can confirm custody — an `admin`-kind organisation, or
any member holding `role = 'custodian'`. The stone appears under **Awaiting
custody** in `/verify`.

Press **Record arrival**, leave "matches the declared carat and dimensions"
ticked, and confirm. It moves to the grading queue.

Worth exercising the other branch on one stone: untick the box and give a reason
of at least ten characters. The server refuses a bare "does not match" — a
divergence with no explanation tells the grader something is wrong but not what.
The note then appears on the grading screen in amber.

Nothing here touches the chain. This is the physical event that the on-chain
`confirmCustody` later attests to during activation.

### 3 · Grade as the lab

Sign in as the **verifier** account and open `/verify`. The stone appears in the
queue. Confirm the seller's identity is nowhere on the page — not their name,
email, or wallet.

Select it, then:

- **Choose the primary image.** The first upload is preselected. Switch to the
  `-alt` render to confirm the choice is honoured; whichever is selected becomes
  the permanent NFT image.
- **Enter the grades** from `stones[].graded`. The price breakdown computes live.
- **Check the figure against the table above**, and that market multipliers all
  read `× 1.000` with `(0/0 bids)` until `v1-demand-refresh` has run.

Approve. That single click runs `registerGem → confirmCustody → verifyGem →
listGem`, plus `createDailyAuction` for auction stones.

### 4 · Verify the result

| Check                                      | Where                              |
| ------------------------------------------ | ---------------------------------- |
| Gem appears with the right price           | `/marketplace` or `/auctions`      |
| **The image you chose** is displayed       | gem card — not the swatch fallback |
| `metadata_cid` and `primary_image_cid` set | `seller_submissions` row           |
| `ipfs://<cid>` resolves to the document    | any public gateway                 |
| Document's `image` matches your choice     | inside that JSON                   |
| On-chain price equals the graded figure    | `getGem(gemId).priceUsd`           |
| Audit trail recorded                       | `valuations` row + `audit_records` |

If the gem card shows the generated facet swatch instead of your photograph, the
metadata has no `image` — almost always a missing `IPFS_PINNING_JWT` at the time
of approval. That cannot be corrected afterwards; the stone has to be resubmitted.

A new listing will not appear in an **already-open** tab. Gem discovery is
memoised for the lifetime of the loaded module and only invalidated by the acting
user's own transaction, and this one was signed server-side by the operator.
Reload.

### 5 · Reject one

Grade a stone and use **Reject** with a reason instead. Confirm status becomes
`rejected`, the reason reaches the seller's page, no gem is registered, and
nothing was pinned. This is the property that makes grading-before-registration
worth the ordering constraint.

## Regenerating

After any change to `_shared/valuationMatrix.ts`:

```bash
node pilot/scripts/build-pilot-pack.mjs
```

The expected figures are computed by importing the real `valuationMath.ts`, never
restated. A matrix change alters prices, and a pack carrying stale hand-copied
numbers would quietly assert the wrong thing — worse than no fixtures, because it
looks like a passing check. The script exits non-zero if any refusal case stops
refusing.

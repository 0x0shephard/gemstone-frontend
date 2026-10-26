# Reserve-free launch, then activation

The protocol can launch with no reserve and switch reserves on later without a
contract upgrade. Who pays: a reserve is always charged to the buyer, on top of
the price, when a stone sells through `PrimarySaleAuction` or `Marketplace` and
its reserve is short. Nobody prefunds it.

## Phase 1: launch at 0%

Deploy with `DEFAULT_RESERVE_BPS=0` and every `RESERVE_BRACKET_BPS` entry `0`
(for example `RESERVE_BRACKET_BPS=0,0`). Leave per-gem `minimumReserveUsd` unset.

- Primary and secondary sales charge only the price; nothing goes to `ReserveManager`.
- Projected liabilities stay at zero, so `requireSolvent` never blocks.
- A token that owes no reserve moves freely: transfers, gifts, swaps, outside
  marketplaces. DGENFT applies the zero-reserve rule only to a token that owes
  reserve under the current policy and holds none.
- Redemption works: with nothing required, the 20% minimum is met.

Until activation the stones have no reserve backing. Public copy must not claim
they do.

## Phase 2: activate

Run `script/ConfigureReservePolicy.s.sol` with the real `DEFAULT_RESERVE_BPS`,
`RESERVE_BRACKET_MAX_USD` and `RESERVE_BRACKET_BPS`, from the admin.

- New primary sales charge the reserve automatically.
- Tokens sold in phase 1 now owe reserve and hold none. Direct transfers, gifts,
  swaps and outside-marketplace sales of those tokens are blocked until funded.
- Their owners can still sell through Digital Carat: `Marketplace.list` pulls the
  token into escrow, and `buy`, `acceptOffer` and listing-auction settlement charge
  the buyer price plus shortfall and fund the reserve before the token is released.
  Until then it can only return to the seller.
- Anyone (the owner, or Digital Carat) can fund a stone directly with
  `ReserveManager.fundNative` / `fundToken`. A swap needs any positive reserve;
  a redemption request needs at least 20% of the requirement.
- Projected liability for an older token is set when it next sells, so activation
  does not make coverage read as insolvent overnight. Until then those tokens are
  outside the coverage ratio.

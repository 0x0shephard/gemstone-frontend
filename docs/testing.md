# Testing

| Layer | Command | What it proves |
|---|---|---|
| Contracts | `npm run test:contracts` | 126 Forge tests incl. invariants, in `../gemstone` |
| Unit | `npm test` | Components, services and edge-function logic with mocks |
| Full stack | `npm run test:e2e:full` | Real UI on a local chain + local Supabase (below) |
| Live canary | `npx playwright test -c playwright.canary.config.ts` | The deployed site and Sepolia are wired together |
| Phones | [phone-testing-runbook.md](phone-testing-runbook.md) | The MetaMask handoff on real devices |

## Full-stack suite

Needs Docker, Foundry and `../gemstone`. Each run resets everything:

1. anvil on :8545 with Sepolia's chain id, Multicall3 installed;
2. `DeployLocalE2E` deploys the protocol and seeds gems and holders
   (Alice, Bob, a seller, a custodian — anvil's public dev accounts);
3. local Supabase is built from `e2e/stack/baseline.sql` plus every real
   migration, then seeded with users, verified wallets and submissions;
4. Playwright serves the edge functions, a mail catcher (:4010, standing in
   for Resend) and an e2e build of the site (:4174).

The browser wallet is `e2e/fixtures/testWallet.ts`: an injected EIP-1193
provider that forwards to anvil, with `window.__e2eWallet` controls to reject
the next request or lose its response.

`npm run test:e2e:full` brings the stack up before each project (Playwright starts
its web servers before global setup, so a fresh clone needs `up` first).
`E2E_REUSE_STACK=1` skips the reset while iterating on one journey.
`npm run e2e:stack:down` stops anvil and Supabase.

## Journeys

| File | Covers |
|---|---|
| `buy.e2e.ts` | list, then purchase by another collector |
| `swap.e2e.ts` | propose and accept; own tokens never offered |
| `gift.e2e.ts` | escrow, sender copy, recipient email, claim |
| `gift-recovery.e2e.ts` | abandoned setup replaced; interrupted gift finished from a new tab |
| `faults.e2e.ts` | wallet rejection; lost reply after broadcast (no second send) |
| `redemption.e2e.ts` | request, custodian hand-over in the verify portal, holder claims the reserve |
| `auction.e2e.ts` | bid, 24 h time travel, settlement by the real `v1-auction-refresh` sweep |

Not yet covered: marketplace offers, redemption cancellation,
notifications, and a real-MetaMask (Synpress) nightly set.

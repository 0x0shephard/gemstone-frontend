# Digital Carat frontend

Production-oriented React frontend for the Digital Carat gemstone protocol. It supports public
browsing plus trader and seller flows for primary sales, auctions, the secondary marketplace,
escrowed offers, DGE swaps, reserve funding, and physical redemption.

The app has two explicit data modes:

- `mock` is a deliberate, independently buildable demo.
- `chain` reads contracts and events directly. It never substitutes mock data when configuration or
  RPC access fails.

The checked-in deployment manifest targets the current Sepolia protocol deployment. Chain mode
displays a blocking configuration report if the manifest, deployment block, or required addresses
are missing or inconsistent.

## Stack

- Vite, React, TypeScript, Tailwind
- wagmi, viem, RainbowKit
- TanStack Query and an IndexedDB chain-event projection
- Supabase Auth, Postgres, Storage, and Edge Functions
- MVP seller auto-verification, with Sumsub integration deferred
- Vitest, React Testing Library, Playwright, axe, ESLint, Prettier
- Sentry with sanitization and opt-in PostHog product events
- Netlify SPA deployment

## Run locally

```sh
npm ci
cp .env.example .env
npm run dev
```

Mock mode needs no contract addresses. Supabase-backed authentication and private workflows require
their public project configuration.

## Quality gates

```sh
npm run contracts:check
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:a11y
npm run test:contracts
```

`npm run check` runs ABI checksum verification, typechecking, lint, unit tests, and the production
build. CI also runs browser accessibility checks and the real Solidity fuzz/invariant suite from
[`0x0shephard/gemstone-contracts`](https://github.com/0x0shephard/gemstone-contracts).

To exercise the deployed Sepolia contracts without broadcasting testnet transactions, start a clean
fork and run the lifecycle verifier:

```sh
anvil --fork-url "$SEPOLIA_RPC_URL" --port 8546 --chain-id 11155111
npm run verify:anvil-lifecycle
```

The verifier uses the sibling contracts deployment manifest and demo inventory. It covers mUSDC
approvals, primary buy-now, secondary listing and purchase, auction bidding and settlement, swaps
with and without a cash delta, offer acceptance and expiry refunds, and redemption request and
cancellation.

## Architecture

```text
src/
  config/                  validated env and deployment manifest
  contracts/generated/     checksummed Foundry ABIs
  services/chain/          reads, event projection, reducers, transaction pipeline
  services/offchain/       private Supabase workflow client
  providers/               wallet, query, auth, Supabase
  components/              accessible UI, sync state, payments, transaction lifecycle
  pages/                   public, trader, redemption, and seller routes
supabase/
  migrations/              executable database upgrades, RLS, and Storage policies
  schema.sql               legacy consolidated reference; do not apply directly
  functions/               SIWE, seller intake, private files, and commitments
```

The browser projection is keyed by chain ID and deployment-manifest hash. It scans bounded adaptive
block ranges, rescans the latest 64 blocks, marks data finalized after 12 confirmations, persists
history, and can serve an explicitly stale cache while RPC access is unavailable. Contract
multicalls remain authoritative for current state.

All contract IDs and values use `bigint` and base units. `gemId`, `tokenId`, marketplace `offerId`,
swap `offerId`, private workflow ID, and display ID are separate types/fields.

## Authentication and private workflows

Public browsing is open. Transactions require:

1. a Supabase session,
2. a connected wallet,
3. a server-verified EIP-4361 SIWE primary-wallet link,
4. the configured chain.

SIWE nonces are single-use and expiring. Wallet replacement requires another signature plus explicit
confirmation. Certificates, gem media, and redemption documents use private buckets, row-level
policies, file constraints, and user-scoped paths.

Seller and redemption commitments are generated in Edge Functions from RFC 8785 canonical JSON and
`keccak256(UTF8(payload))`, with a random 32-byte nonce. The exact canonical payload is retained
privately; only its hash and approved public metadata reach the protocol.

Seller intake takes one of two paths, chosen by the `verification_mode` row in `protocol_settings`.
Only an `org_admin` of an `admin`-kind verifier organisation can change it, from the portal; there is
no client write policy on that table, so a seller cannot route their own stone around a lab. Both
paths first check that the authenticated user controls the submitted primary wallet and that the
private evidence package holds at least one certificate and one gemstone image.

`lab` is the default. The submission parks at `awaiting_grading` and **nothing is written on-chain
or published**. A grading lab prices it, and only that approval registers the gem, records protocol
custody, records the graded valuation, and activates the seller-selected buy-now listing or 24-hour
auction. A rejected stone therefore leaves no permanent trace and costs no gas.

`auto` restores the earlier straight-through `mvp-auto` path for Sepolia demos and the lifecycle
verifier, which have no seeded lab account. It prices with the test-only `mvp-flat-carat-v1` rule —
$500 per carat, rounded up to whole USD and clamped to $100–$25,000. That is not a production
appraisal, and `approvedValuationUsd` has no setter, so the mode is worth switching deliberately.
Every change is audit-logged with the organisation, the previous mode, and the new one.

The full path from a browser action to each contract call is mapped in
[`docs/workflows.md`](./docs/workflows.md).

## Environment and deployment

See [`.env.example`](./.env.example) for the complete contract. Important values include data mode,
chain/RPC, deployment block, module addresses, USDC, IPFS gateway, Supabase, Sentry, and PostHog.
The Supabase URL must be the API URL (`https://<project-ref>.supabase.co`).

Never put a Supabase service-role key in a `VITE_` variable. Vite variables are client-visible, and
the build intentionally fails if `VITE_SUPABASE_SERVICE_ROLE_KEY` exists. Supabase injects the
server-only `SUPABASE_SERVICE_ROLE_KEY` into deployed Edge Functions automatically.

### Supabase workflow deployment

The ordered migrations upgrade the current `profiles`, `kyc_status`, and legacy
`seller_submissions` tables in place:

```sh
npx supabase login
npx supabase link --project-ref ozqesbzewekolpeaxaux
npx supabase db push
npx supabase secrets set \
  SITE_ORIGIN=http://localhost:5173 \
  CHAIN_ID=11155111 \
  SEPOLIA_RPC_URL=... \
  LOGS_RPC_URL=... \
  SEPOLIA_OPERATOR_PRIVATE_KEY=... \
  GEM_REGISTRY_ADDRESS=0x... \
  PRIMARY_SALE_AUCTION_ADDRESS=0x... \
  DEPLOYMENT_BLOCK=... \
  IPFS_PINNING_JWT=... \
  DEMAND_REFRESH_SECRET=... \
  AUCTION_REFRESH_SECRET=... \
  NOTIFY_SWEEP_SECRET=... \
  RESEND_API_KEY=... \
  MAIL_FROM='Digital Carat <alerts@digitalcarat.io>' \
  VAPID_PUBLIC_KEY=... \
  VAPID_PRIVATE_KEY=... \
  VAPID_SUBJECT=mailto:support@digitalcarat.io
npx supabase functions deploy v1-siwe-nonce
npx supabase functions deploy v1-siwe-verify
npx supabase functions deploy v1-seller-submit
npx supabase functions deploy v1-seller-commitment
npx supabase functions deploy v1-seller-activate
npx supabase functions deploy v1-verification-queue
npx supabase functions deploy v1-verification-grade
npx supabase functions deploy v1-verification-settings
npx supabase functions deploy v1-demand-refresh
npx supabase functions deploy v1-auction-refresh
npx supabase functions deploy v1-notify-sweep
npx supabase functions deploy v1-gift-create v1-gift-claim v1-gift-cancel v1-gift-notify
npx supabase functions deploy v1-custody-confirm
npx supabase functions deploy v1-private-file-url
npx supabase functions deploy v1-redemption-commitment
```

`IPFS_PINNING_JWT` enables public metadata publication. Without it, submissions keep the inline
`data:` metadata URI used by the Sepolia MVP. With it, `prepareSellerSubmission` pins the canonical
document, reads it back from at least two independent gateways, and only then writes `ipfs://<CID>`
into the evidence commitment and `registerGem`. Any failure aborts activation rather than degrading,
because `metadataURI` has no setter in `GemRegistry` or `DGENFT` and cannot be corrected afterwards.
Set `IPFS_VERIFICATION_GATEWAYS` to a comma-separated list to check additional gateways first.

The exact published bytes are retained in `seller_submissions.metadata_document` beside the CID.
Re-pinning those bytes reproduces the same CID, so a lapsed pin can be restored without changing
anything on-chain. Treat that column as the canonical record.

### Verification portal

Third-party grading labs sign in with Supabase credentials and hold no wallet. Authority comes from
a row in `verifier_members`, and the operator key relays their decision on-chain. Onboard a lab by
inserting an organisation and a membership:

```sql
insert into public.verifier_organizations (name, kind) values ('Example Gem Lab', 'lab');
insert into public.verifier_members (profile_id, organization_id, role)
values ('<profile-uuid>', '<organization-uuid>', 'grader');
```

An `admin`-kind organisation whose member holds `org_admin` additionally sees the verification-mode
switch. Create one the same way, with `kind = 'admin'` and `role = 'org_admin'`.

`/verify` is absent from navigation and returns "page not found" to anyone without an active
membership — the same response the API gives, so the route does not advertise itself. Graders see
the stone, its unverified seller claims and the evidence files, but never the seller's identity:
that is stripped by the column selection in the Edge Function, not hidden in the UI.

Approving a grading prices the stone, records it, and immediately runs the resumable activation,
which registers, confirms custody, verifies at the graded valuation and lists. A stone the matrix
cannot price is refused with an explanation rather than valued by guesswork, and a grader can reject
outright with a reason the seller sees. Because grading now precedes every on-chain write, a
rejection has nothing to unwind.

The grading form's dropdowns are served by `matrixOptions()`, from the same versioned matrix that
prices the stone, rather than restated in the component. A test walks the full cross product of
advertised options and asserts every one of them is priceable, so the form cannot offer a value the
engine would refuse after the grader has already assessed the stone.

The grader also chooses which of the seller's photographs becomes the public NFT `image`. That
image is pinned to IPFS and read back from independent gateways, its CID is sealed into the metadata
document, and `registerGem` writes that document's URI to a field with no setter — so the choice is
permanent and belongs at the review step. Certificates are never eligible: they routinely carry the
seller's name and appraisal history, and eligibility is decided server-side rather than left to the
UI. Without `IPFS_PINNING_JWT` the inline `data:` document is kept and no image is published, which
is the degraded Sepolia MVP path.

`DEMAND_REFRESH_SECRET` gates `v1-demand-refresh`, which ingests `BidPlaced` events into the demand
counts behind the pricing engine's market multipliers. `AUCTION_REFRESH_SECRET` gates
`v1-auction-refresh`, which re-opens the 24-hour auction for stones that drew no bid, up to 60
rounds. Both are scheduled jobs, not user-facing endpoints: callers present the secret in
`x-demand-refresh-secret` or `x-auction-refresh-secret` rather than a Supabase session.

`NOTIFY_SWEEP_SECRET` gates `v1-notify-sweep`, which records in-app alerts and delivers configured
email and Web Push messages. `RESEND_API_KEY` and a verified `MAIL_FROM` enable transactional email;
the VAPID key pair enables Web Push. The same public key must be supplied to the frontend as
`VITE_VAPID_PUBLIC_KEY`. `LOGS_RPC_URL` is optional, but if supplied it must accept wide
`eth_getLogs` ranges; otherwise the functions use the read-only public Sepolia fallback. The
scheduled workflow drains resumable notification passes until all four contract cursors reach the
chain head and fails visibly if they do not.

Both are listed with `verify_jwt = false` in [`supabase/config.toml`](./supabase/config.toml).
Without that the platform rejects a scheduler with `401` *before* the function runs, which is
indistinguishable from a working cron that does nothing — the secret each function checks itself is
the actual authorization. A scheduler therefore needs only:

```sh
curl -X POST "https://<project-ref>.supabase.co/functions/v1/v1-auction-refresh" \
  -H "x-auction-refresh-secret: $AUCTION_REFRESH_SECRET"
```

Running the auction sweep more often than daily is harmless: an auction that has not expired is
skipped untouched, and one with a winning bid is left for settlement rather than cancelled.
Running it is idempotent — bids are keyed by transaction hash and log index, so replayed ranges
cannot double count. Until it runs, every market multiplier resolves to a neutral 1.0 and stones are
priced on base value alone, which is correct behaviour rather than a failure.

`SEPOLIA_OPERATOR_PRIVATE_KEY` is a server-only testnet signer. Never prefix it with `VITE_`, expose
it to the browser, or reuse it for mainnet. The signer must hold the deployed registry compliance,
lister, custodian, and verifier roles plus the primary-sale lister role. Seller activation is
resumable and records every step transaction hash so retries do not intentionally register a second
gem.

The Sumsub token and webhook sources are retained for the later integration, but they are not part
of the MVP deployment above. Replace `SITE_ORIGIN` with the stable Netlify origin before deploying
the production frontend.

For local development, Vite reuses `SEPOLIA_RPC_URL` from the sibling `../gemstone/.env` when it is
an Alchemy Sepolia endpoint. An explicit shell, CI, or Netlify `VITE_RPC_URL` value takes precedence.
The RPC credential is never copied into this repository. Chain mode keeps that endpoint first, then
uses `VITE_RPC_FALLBACK_URL` and the public Sepolia transport if the preferred endpoint is unavailable.
This is RPC failover for the same chain state; the app never substitutes mock data.

### Google authentication setup

Google sign-in requires project-side configuration in addition to the public frontend keys:

1. Create a Google OAuth client of type **Web application**.
2. Add the Supabase callback URL shown on the Supabase Google provider page as an authorized
   redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. In **Supabase → Authentication → Providers → Google**, enable Google and save the OAuth client ID
   and client secret.
4. In **Supabase → Authentication → URL Configuration**, set the stable production Site URL and
   allow `http://localhost:5173/onboarding` plus the deployed `/onboarding` URLs used by Netlify
   previews.

The app checks the project’s public Auth settings. When Google is disabled, it shows a specific
configuration message instead of presenting a non-functional OAuth button.

Netlify configuration and SPA rewrites are in [`netlify.toml`](./netlify.toml). Deploy previews use
mock mode by default. A stable Sepolia chain build should be enabled only after addresses, deployment
block, oracle/payment configuration, seeded gems, and role-operated auctions have been validated.

Contract/ABI ownership details are in [INTEGRATION.md](./INTEGRATION.md). Protocol documentation
lives in the contracts repository rather than being duplicated here.

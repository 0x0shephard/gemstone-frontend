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

For the Sepolia MVP, seller intake uses a clearly marked `mvp-auto` verifier. The server verifies
that the authenticated user controls the submitted primary wallet and that the private evidence
package contains at least one certificate and one gemstone image before approving it. It then
creates an evidence commitment and a test-only `mvp-flat-carat-v1` valuation commitment, registers
the gem, records protocol custody, records the valuation, and activates the seller-selected buy-now
listing or 24-hour auction. The temporary rule is $500 per carat, rounded up to whole USD and clamped
to $100–$25,000. It is not a production appraisal. Sumsub and the offline pricing/verification
engine can replace the approval and valuation transitions later without changing the browser’s
submission interface.

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
  SEPOLIA_OPERATOR_PRIVATE_KEY=... \
  GEM_REGISTRY_ADDRESS=0x... \
  PRIMARY_SALE_AUCTION_ADDRESS=0x... \
  DEPLOYMENT_BLOCK=...
npx supabase functions deploy v1-siwe-nonce
npx supabase functions deploy v1-siwe-verify
npx supabase functions deploy v1-seller-submit
npx supabase functions deploy v1-seller-commitment
npx supabase functions deploy v1-seller-activate
npx supabase functions deploy v1-private-file-url
npx supabase functions deploy v1-redemption-commitment
```

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

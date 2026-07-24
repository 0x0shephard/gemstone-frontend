# Digital Carat frontend

Production-oriented React frontend for the Digital Carat gemstone protocol. It supports public
browsing plus trader and seller flows for primary sales, auctions, the secondary marketplace,
escrowed offers, DGE swaps, reserve funding, and physical redemption.

The app has two explicit data modes:

- `mock` is a deliberate, independently buildable demo.
- `chain` reads contracts and events directly. It never substitutes mock data when configuration or
  RPC access fails.

Sepolia addresses and the deployment block are intentionally pending. Until they are provided,
chain mode displays a blocking configuration report.

## Stack

- Vite, React, TypeScript, Tailwind
- wagmi, viem, RainbowKit
- TanStack Query and an IndexedDB chain-event projection
- Supabase Auth, Postgres, Storage, and Edge Functions
- Sumsub sandbox KYC/KYB
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
  schema.sql               RLS tables and private Storage policies
  functions/               SIWE, Sumsub, seller and redemption commitments
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

## Environment and deployment

See [`.env.example`](./.env.example) for the complete contract. Important values include data mode,
chain/RPC, deployment block, module addresses, USDC, IPFS gateway, Supabase, Sentry, and PostHog.
The Supabase URL must be the API URL (`https://<project-ref>.supabase.co`).

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

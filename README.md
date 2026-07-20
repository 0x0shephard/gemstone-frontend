# Digital Carat — Frontend

React frontend for **Digital Carat**, a gemstone-backed NFT protocol where each DGE
NFT represents one verified physical gemstone. The UI covers the full protocol surface:
primary buy-now & auctions, a secondary marketplace with 24-hour offers, DGE-to-DGE
swaps, reserve top-ups, physical redemption, and a seller portal.

> **Status:** the UI is complete and runs against a **mock data service**. Real on-chain
> integration (wagmi + generated ABIs) is deferred — see [Contract integration](#contract-integration).

## Stack

- **Vite + React + TypeScript** (SPA)
- **Tailwind CSS** — design tokens in `src/theme/tokens.css` + `tailwind.config.js`
- **wagmi + viem + RainbowKit** — wallet connection (chain from `VITE_CHAIN_ID`, default Sepolia)
- **TanStack Query** — all reads/writes go through hooks in `src/hooks/useData.ts`
- **Supabase** — Google OAuth + email magic-link auth (`src/providers/AuthProvider.tsx`)
- **React Three Fiber** — the rotating 3D ruby on the landing hero (`src/components/three/GemScene.tsx`)
- **React Hook Form + Zod** — form validation

## Getting started

```bash
npm install
cp .env.example .env      # fill in what you have; blanks degrade gracefully
npm run dev               # http://localhost:5173
```

Other scripts:

```bash
npm run build       # typecheck + production build
npm run typecheck   # tsc --noEmit
npm run preview     # serve the production build
```

The app is fully explorable **without any env configured** — auth shows an "auth not
configured" notice, the wallet modal supports injected wallets, and all data comes from
the mock service.

## Environment variables

See [`.env.example`](./.env.example). Summary:

| Variable | Purpose |
|---|---|
| `VITE_CHAIN_ID` | Target chain (default `11155111` Sepolia; `31337` for local) |
| `VITE_RPC_URL` | RPC endpoint |
| `VITE_EXPLORER_BASE_URL` | Block-explorer base for tx/address links |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect modal (from cloud.walletconnect.com) |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase auth |
| `VITE_SUMSUB_BACKEND_URL` | Backend that mints Sumsub KYC tokens (**never a Sumsub secret**) |
| `VITE_CONTRACT_*` | Address of each protocol module (blank until deployed) |

## Architecture

```
src/
  config/       env, chains, contract address map (from env, no hardcoded addresses)
  providers/    wagmi, RainbowKit theme, TanStack Query, Supabase, AuthProvider
  services/     data-service ABSTRACTION — IDataService, mock impl, seed data
  hooks/        useData (TanStack Query wrappers), useKyc, useCountdown, useScrollReveal…
  contracts/    PLACEHOLDER ABIs + address pairing (not wired to reads yet)
  components/    ui/ · gem/ · wallet/ · payment/ · tx/ · kyc/ · modals/ · layout/ · three/
  pages/        Landing, Login, Signup, Onboarding, Marketplace, GemDetail,
                Auctions, Swaps, Redeem, Profile, Seller, About
  theme/        tokens.css (design tokens + fonts)
```

### Data layer (the key abstraction)

Every page consumes `IDataService` (`src/services/IDataService.ts`) through the hooks in
`src/hooks/useData.ts`. Today the active implementation is `mockService`
(`src/services/index.ts`), which serves the fixtures in `src/services/mockData.ts` (ported
from the design mockup). Writes resolve a mock tx hash after simulated confirmation latency.

## Contract integration

Real ABIs are intentionally deferred. To integrate:

1. Compile the contracts and copy generated ABIs into `src/contracts/abis/` (replace the
   placeholder fragments; each carries a `// TODO: replace with generated ABI` banner).
2. Set `VITE_CONTRACT_*` addresses in `.env`.
3. Add a `wagmiService` implementing `IDataService` (reads via `viem`/wagmi, events for
   history) and switch it in at `src/services/index.ts`.

No page or component changes are required — the service interface is the seam.

Conventions the UI already follows: `address(0)` for native ETH; ERC-20 payments show an
approve-then-call note; reserve shortfall is **always** surfaced (never hidden) and added to
the buyer's total; seller/redemption actions are gated on KYC and never claim on-chain roles
the wallet may not hold ("Requires protocol approval").

## Design

All-black luxury-vault aesthetic: vault-black `#08080A` surfaces, graphite cards with silver
hairline borders, silver-gradient primary buttons, and ruby/sapphire/emerald/amber gem
accents. Manrope for text, JetBrains Mono for all figures.

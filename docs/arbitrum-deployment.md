# Arbitrum One deployment

Contract-side readiness for a production deployment on Arbitrum One (chain 42161).
The deploy template is `gemstone/.env.l2.example`; its feed and token addresses
were checked on-chain on 2026-10-26.

## What the contracts now handle

- **Feed staleness per feed.** `PRICE_STALE_AFTER` is the default;
  `ETH_USD_STALE_AFTER` and `PAYMENT_TOKEN_STALE_AFTERS` override it. Arbitrum's
  ETH/USD and USDC/USD feeds update at least once every 24 hours, so the template
  uses 25 hours (90000s). A one-hour window would reject valid prices most of the day.
- **Sequencer uptime.** `PaymentTokenRegistry` refuses every quote while the
  Arbitrum sequencer is down and for `SEQUENCER_GRACE_PERIOD` (default one hour)
  after it is back. A production deploy to Arbitrum One or Nova, OP Mainnet or Base
  refuses to run without `SEQUENCER_UPTIME_FEED`. Unset on Sepolia and L1, where the
  check is skipped. During an outage, auction settlement reverts and is retried later
  instead of refunding the winner, and solvency and swap checks report the outage
  rather than an empty reserve.
- **Price outages do not freeze ownership.** DGENFT's zero-reserve rule now asks
  whether reserve assets are held (`ReserveManager.hasReserveAssets`), not their
  oracle value, so a stale feed or sequencer outage pauses sales and redemptions
  but not transfers of funded tokens.
- **Minting.** A production deploy revokes the admin's NFT `MINTER_ROLE`; only
  `PrimarySaleAuction` mints.
- **Builds** are pinned to `evm_version = "cancun"`; `foundry.toml` has an
  Arbiscan verification entry (`ARBISCAN_API_KEY`).

## Deploy

```bash
forge script script/DeployDigitalCarat.s.sol --rpc-url "$RPC_URL" --broadcast --verify --etherscan-api-key "$ARBISCAN_API_KEY"
```

Rehearse first on an Arbitrum fork (`anvil --fork-url "$RPC_URL"`), then record the
addresses in a deployment manifest as for Sepolia.

## Bringing the same changes to Sepolia (optional)

Upgrade in this order. Each later contract calls something only the earlier
upgrades add: `PaymentTokenRegistry.requireSequencerUp` (ReserveManager,
Marketplace, PrimarySaleAuction, SwapEscrow) and `ReserveManager.hasReserveAssets`
(DGENFT, on every transfer, so a DGENFT upgrade done first would block all transfers):

1. PaymentTokenRegistry (leave the sequencer feed unset)
2. ReserveManager
3. Marketplace, PrimarySaleAuction, SwapEscrow
4. DGENFT

Each is a plain `upgradeToAndCall(newImplementation, "")`. Sepolia needs the
high gas limit described in the deploy notes (`cast send --create … --gas-limit 32000000`).

## Still to do before mainnet (not contract code)

- Event scanning: a logs RPC that accepts wide block ranges (`LOGS_RPC_URL`), an
  Arbitrum logs client in the app, and scan windows sized by time, not blocks.
- Supabase: one active deployment per project, so cut over from Sepolia or use a
  second project; a new `protocol_deployments` row and release manifest.
- App and edge configuration: `CHAIN_ID=42161`, RPC and explorer URLs,
  `VITE_EXPLORER_BASE_URL=https://arbiscan.io`, "Sepolia" labels in the UI.
- Keys: move admin and upgrader roles to a Safe with a timelock, give the gift
  operator its own key, keep the edge key to operational roles.
- External audit.

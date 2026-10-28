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

## Outside marketplaces (OpenSea and others)

DGENFT is a standard ERC-721 with ERC-2981 royalties, so OpenSea and other
marketplaces on the chain index it automatically. Owners list from their own
wallet; the token stays there until it sells. The contract's rules still apply to
those sales: a token being redeemed, or one that owes reserve and holds none,
cannot be transferred, so such a listing cannot be filled.

- `owner()` returns the collection owner OpenSea uses to let an account claim and
  edit the collection page (set with `setCollectionOwner`, or `COLLECTION_OWNER`
  at deploy). It is display only and grants nothing in the contract. Use a Safe:
  OpenSea lets it change the collection's payout address.
- `contractURI()` (ERC-7572) points at `https://digitalcarat.io/collection.json`,
  served from `public/collection.json`. Change it with `setContractURI`.
- Royalty: `ROYALTY_RECEIVER` and `ROYALTY_BPS`, or `setDefaultRoyalty` later;
  the contract caps it at 10%. Marketplaces may treat royalties as optional.
- The Digital Carat marketplace does not pay the ERC-2981 royalty; it charges
  its own secondary fee to the platform recipient. Outside sales pay the royalty
  (if the marketplace honours it) and skip that fee and the reserve top-up the
  in-house marketplace charges. Setting the royalty receiver to the platform
  recipient keeps both routes paying the same account. A partly funded token can
  sell outside without the top-up; the stone's existing reserve stays with it.
- The gem page links to the token's OpenSea page on chains OpenSea lists. OpenSea
  retired its testnet site, so there is no link on Sepolia.

After deploying: from the collection-owner Safe, claim the collection on OpenSea,
then set its creator earnings and links there.

## Deploy

```bash
forge script script/DeployDigitalCarat.s.sol --rpc-url "$RPC_URL" --broadcast --verify --etherscan-api-key "$ARBISCAN_API_KEY"
```

Rehearse first on an Arbitrum fork (`anvil --fork-url "$RPC_URL"`), then record the
addresses in a deployment manifest as for Sepolia. The fork run used 32.75M gas, about
0.00067 ETH. Never broadcast from anvil's default accounts on a mainnet fork: they carry
EIP-7702 sweeper delegations there.

Production requires `MINIMUM_COVERAGE_BPS` (90–100%; `.env.l2.example` uses 9500). At
100% there is no headroom: once reserves are on, a 0.05% dip in the price of the ETH
held as reserve stops every purchase.

### Hand the roles to the Safe

The deployer ends up holding 30 roles (admin and upgrader on all ten contracts, plus
operational ones). Move them to the Safe in two runs, checking the first before the
second:

```bash
forge script script/HandoverRoles.s.sol --sig "grant()" --rpc-url "$RPC_URL" --broadcast
forge script script/HandoverRoles.s.sol --sig "renounce()" --rpc-url "$RPC_URL" --broadcast
```

`renounce()` refuses until the Safe (`NEW_ADMIN`) holds every role the deployer does.
Afterwards the deployer key can do nothing: upgrades, policy changes and role grants
are Safe transactions, and the Safe grants the operational roles (lister, custodian,
verifier, ...) to the wallets that need them. Before this, raise the Safe's threshold
to 2 with a hardware-wallet owner and remove the hot operator key as an owner.

### Bids are binding

A leading auction bid can no longer be withdrawn while its auction runs (`BidLocked`).
It can be withdrawn once 7 days have passed since the close without anyone settling, or
at any time while the contract is paused. When upgrading Sepolia (below), upgrade
Marketplace and PrimarySaleAuction while no auction has a live leading bid, or tell
those bidders first: their bids become binding the moment the upgrade lands.

## Bringing the same changes to Sepolia (optional)

Upgrade in this order. Each later contract calls something only the earlier
upgrades add: `PaymentTokenRegistry.requireSequencerUp` (ReserveManager,
Marketplace, PrimarySaleAuction, SwapEscrow, RedemptionManager) and `ReserveManager.hasReserveAssets`
(DGENFT, on every transfer, so a DGENFT upgrade done first would block all transfers):

1. PaymentTokenRegistry (leave the sequencer feed unset)
2. ReserveManager
3. Marketplace, PrimarySaleAuction, SwapEscrow, RedemptionManager
4. DGENFT (also adds `owner()` and `contractURI()`, both empty until set)

Each is a plain `upgradeToAndCall(newImplementation, "")`. Run every upgrade script with
`--broadcast --slow --skip-simulation`. Sepolia prices contract creation about 7x above
forge's local simulation (implementations took 14–30M gas on 2026-10-28), so a simulated
gas limit runs out; `--skip-simulation` takes each limit from the node. Rehearse first with
`scripts/rehearse-upgrade.mjs` and anvil 1.8 or later: older anvil forks use the old
pricing and pass upgrades the real chain would reject. Then record a manifest per upgraded
proxy in the contracts repo's `deployments/`, or the canary reports the new implementations
as unexpected.

## Configuration for Arbitrum

Event history is scanned in blocks, and Arbitrum makes one every 0.25 s (14,400 an
hour, against 300 on Sepolia):

- **Browser RPC (`VITE_RPC_URL`)** must accept `eth_getLogs` spans of at least a few
  thousand blocks. After a lost wallet reply the app scans from the block it sent at,
  about 2,400 blocks per 10 minutes away. The Alchemy key accepted 1,000,000-block
  spans on arb-mainnet. `VITE_LOGS_RPC_URL` optionally adds a dedicated endpoint for
  history scans; it is tried first, on any chain.
- **Edge `LOGS_RPC_URL`**: on chains other than Sepolia, edge scans use `RPC_URL` when
  this is unset, so set it, or make sure the operator RPC accepts wide spans.
- Lookbacks are measured in time and converted with each chain's block time
  (`supabase/functions/_shared/blockTime.ts`): the notification sweep's first run
  covers a week (2.4M blocks on Arbitrum), never before the deployment block.
  Registration recovery after an interrupted seller activation uses the adaptive
  scanner, and refuses to report "not registered" until it has read the whole range.
- **Canary**: reads the chain and manifests from the production release in
  `netlify.toml`, so it follows the switch. It also fails, which emails the repository
  owner, when the operator wallet drops below 0.0003 ETH on Arbitrum (0.02 on
  Sepolia). Add the proof approver and authorizer to the repository variable
  `CANARY_WATCH_WALLETS` (comma-separated).
- App and edge: `CHAIN_ID=42161`, RPC and explorer URLs,
  `VITE_EXPLORER_BASE_URL=https://arbiscan.io`. The footer takes the chain name from
  the configuration.

## Still to do before mainnet

- Supabase: one active deployment per project, so cut over from Sepolia or use a
  second project; a new `protocol_deployments` row and release manifest.
- Give the gift operator its own key, and keep the edge key to operational roles.
- Confirm the custody and insurance claims on the site ("Insured by Lloyd's
  syndicate", "Helvetia Vault Services", "Insured vaults").
- External audit.

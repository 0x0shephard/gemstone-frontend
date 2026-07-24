# Digital Carat integration

The Solidity source of truth is the sibling
[`gemstone-contracts`](https://github.com/0x0shephard/gemstone-contracts) repository. Product and
protocol documentation belongs there; this frontend intentionally does not duplicate that document
bundle.

## ABI workflow

Compile the contracts, then sync and verify their public interfaces:

```sh
cd ../gemstone
forge build
cd ../gemstone-frontend
npm run contracts:sync
npm run contracts:check
```

The sync command extracts ABIs from Foundry artifacts and records SHA-256 checksums under
`src/contracts/generated/`. CI rejects edited or stale generated ABI files.

## Data modes

- `VITE_DATA_MODE=mock` is an explicit demonstration environment.
- `VITE_DATA_MODE=chain` uses the deployment manifest assembled from environment variables. Every
  address, the deployment block, ETH sentinel, USDC address, chain ID, and RPC must validate. An
  incomplete manifest displays a blocking configuration screen; chain mode never falls back to
  fixtures.

Sepolia addresses and the deployment block remain intentionally unset until the authorized
deployment is supplied and verified.


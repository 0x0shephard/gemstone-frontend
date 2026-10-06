#!/usr/bin/env node
/**
 * Rehearses contract upgrades on a local fork of the live network before
 * anyone broadcasts them.
 *
 *   SEPOLIA_RPC_URL=… node scripts/rehearse-upgrade.mjs UpgradeSwapEscrow UpgradeDGENFTReserveGuard
 *
 * Never needs the real deployer key. On the fork, the recorded admin is
 * impersonated and grants DEFAULT_ADMIN_ROLE and UPGRADER_ROLE to a throwaway
 * anvil account, which then runs the upgrade scripts exactly as written.
 * Afterwards it checks that every token keeps its owner and gem, that every
 * token held by an escrow has a recorded depositor (when the NFT exposes one),
 * which implementations changed, and that an ordinary transfer still works.
 *
 * Extra script inputs (e.g. LEGACY_ESCROW_TOKEN_IDS) pass through from the
 * environment. Exit code is non-zero on any failed check.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  zeroHash,
} from 'viem';

const root = path.resolve(import.meta.dirname, '..');
const contractsDir = path.resolve(root, process.env.CONTRACTS_DIR ?? '../gemstone');
const source = process.env.SEPOLIA_RPC_URL;
const scripts = process.argv.slice(2);
if (!source || scripts.length === 0) {
  console.error('usage: SEPOLIA_RPC_URL=… node scripts/rehearse-upgrade.mjs <UpgradeScript>…');
  process.exit(2);
}

const PORT = 8549;
const FORK = `http://127.0.0.1:${PORT}`;
// anvil's first development account: the throwaway rehearsal signer.
const REHEARSER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const REHEARSER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const UPGRADER_ROLE = keccak256(stringToHex('UPGRADER_ROLE'));

const manifest = JSON.parse(
  // The live suite may be a newer manifest than sepolia.json (e.g. a fresh deployment).
  fs.readFileSync(
    path.join(contractsDir, 'deployments', process.env.DEPLOYMENT_MANIFEST ?? 'sepolia.json'),
    'utf8',
  ),
);
const addresses = manifest.addresses;
const client = createPublicClient({ transport: http(FORK, { timeout: 60_000 }) });
const nftAbi = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function tokenGem(uint256) view returns (uint256)',
  'function transferLocked(uint256) view returns (bool)',
  'function escrowDepositor(uint256) view returns (address)',
  'function transferFrom(address from, address to, uint256 tokenId)',
]);
const rolesAbi = parseAbi(['function grantRole(bytes32 role, address account)']);
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

async function rpc(method, params = []) {
  return client.request({ method, params });
}

async function sendAs(from, to, data) {
  const hash = await rpc('eth_sendTransaction', [{ from, to, data }]);
  const receipt = await client.waitForTransactionReceipt({ hash });
  return receipt.status === 'success';
}

async function tokens() {
  const found = [];
  for (let tokenId = 1n, misses = 0; misses < 10; tokenId += 1n) {
    try {
      const [owner, gem] = await Promise.all([
        client.readContract({
          address: addresses.DGENFT,
          abi: nftAbi,
          functionName: 'ownerOf',
          args: [tokenId],
        }),
        client.readContract({
          address: addresses.DGENFT,
          abi: nftAbi,
          functionName: 'tokenGem',
          args: [tokenId],
        }),
      ]);
      found.push({ tokenId, owner: getAddress(owner), gem });
      misses = 0;
    } catch {
      misses += 1; // burned (redeemed) or never minted
    }
  }
  return found;
}

async function implementations() {
  const result = {};
  for (const [name, address] of Object.entries(addresses)) {
    const slot = await client.getStorageAt({ address, slot: IMPLEMENTATION_SLOT });
    if (slot && slot !== zeroHash) result[name] = `0x${slot.slice(-40)}`;
  }
  return result;
}

const anvil = spawn('anvil', ['--fork-url', source, '--port', String(PORT), '--silent'], {
  stdio: 'ignore',
});
try {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rpc('eth_chainId');
      break;
    } catch {
      if (attempt > 60) throw new Error('fork did not start');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const chainId = Number(await rpc('eth_chainId'));
  console.log(`fork of chain ${chainId} at block ${await client.getBlockNumber()}`);

  const admin = getAddress(manifest.admin);
  await rpc('anvil_impersonateAccount', [admin]);
  await rpc('anvil_setBalance', [admin, '0x56BC75E2D63100000']);
  for (const address of Object.values(addresses)) {
    for (const role of [zeroHash, UPGRADER_ROLE]) {
      await sendAs(
        admin,
        address,
        encodeFunctionData({ abi: rolesAbi, functionName: 'grantRole', args: [role, REHEARSER] }),
      ).catch(() => false);
    }
  }

  const before = await tokens();
  const implementationsBefore = await implementations();
  console.log(`${before.length} live tokens recorded`);

  const env = {
    ...process.env,
    PRIVATE_KEY: REHEARSER_KEY,
    EXPECTED_CHAIN_ID: String(chainId),
    DGE_NFT_ADDRESS: addresses.DGENFT,
    RESERVE_MANAGER_ADDRESS: addresses.ReserveManager,
    REDEMPTION_MANAGER_ADDRESS: addresses.RedemptionManager,
    SWAP_ESCROW_ADDRESS: addresses.SwapEscrow,
    MARKETPLACE_ADDRESS: addresses.Marketplace,
    PRIMARY_SALE_ADDRESS: addresses.PrimarySaleAuction,
    PAYMENT_TOKEN_REGISTRY_ADDRESS: addresses.PaymentTokenRegistry,
    GIFT_OPERATOR_ADDRESS: process.env.GIFT_OPERATOR_ADDRESS ?? manifest.admin,
  };
  // Fork broadcasts are not deployment records: remember what exists so only
  // the rehearsal's own files are removed and committed records are restored.
  const broadcastState = new Map();
  for (const script of scripts) {
    const dir = path.join(contractsDir, 'broadcast', `${script}.s.sol`, String(chainId));
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const latest = path.join(dir, 'run-latest.json');
    broadcastState.set(dir, {
      files: new Set(files),
      latest: fs.existsSync(latest) ? fs.readFileSync(latest) : undefined,
    });
  }
  for (const script of scripts) {
    try {
      execFileSync(
        'forge',
        ['script', `script/${script}.s.sol:${script}`, '--rpc-url', FORK, '--broadcast', '--slow'],
        {
          cwd: contractsDir,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      check(true, `${script} executed on the fork`);
    } catch (error) {
      check(
        false,
        `${script} failed: ${String(error.stderr ?? error.message)
          .split('\n')
          .slice(-6)
          .join(' ')}`,
      );
    }
  }
  for (const [dir, { files, latest }] of broadcastState) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!files.has(file)) fs.rmSync(path.join(dir, file));
    }
    if (latest) fs.writeFileSync(path.join(dir, 'run-latest.json'), latest);
    if (fs.readdirSync(dir).length === 0) fs.rmSync(dir, { recursive: true });
  }

  const after = await tokens();
  const byId = new Map(after.map((token) => [token.tokenId, token]));
  const changed = before.filter((token) => {
    const now = byId.get(token.tokenId);
    return !now || now.owner !== token.owner || now.gem !== token.gem;
  });
  check(
    changed.length === 0,
    `every token kept its owner and gem (${changed.map((t) => t.tokenId).join(', ') || 'none changed'})`,
  );

  const escrows = new Set(
    [addresses.Marketplace, addresses.SwapEscrow, env.GIFT_OPERATOR_ADDRESS].map((a) =>
      getAddress(a),
    ),
  );
  for (const token of after.filter((t) => escrows.has(t.owner))) {
    const depositor = await client
      .readContract({
        address: addresses.DGENFT,
        abi: nftAbi,
        functionName: 'escrowDepositor',
        args: [token.tokenId],
      })
      .catch(() => undefined);
    if (depositor === undefined) break; // NFT without the reserve guard
    check(
      depositor !== '0x0000000000000000000000000000000000000000',
      `escrowed token ${token.tokenId} has a recorded depositor`,
    );
  }

  const implementationsAfter = await implementations();
  for (const [name, implementation] of Object.entries(implementationsAfter)) {
    if (implementation !== implementationsBefore[name])
      console.log(`CHANGED ${name}: ${implementationsBefore[name]} -> ${implementation}`);
  }

  const movable = after.find((t) => !escrows.has(t.owner));
  if (movable) {
    const locked = await client.readContract({
      address: addresses.DGENFT,
      abi: nftAbi,
      functionName: 'transferLocked',
      args: [movable.tokenId],
    });
    if (!locked) {
      await rpc('anvil_impersonateAccount', [movable.owner]);
      await rpc('anvil_setBalance', [movable.owner, '0x56BC75E2D63100000']);
      const moved = await sendAs(
        movable.owner,
        addresses.DGENFT,
        encodeFunctionData({
          abi: nftAbi,
          functionName: 'transferFrom',
          args: [movable.owner, REHEARSER, movable.tokenId],
        }),
      ).catch(() => false);
      check(moved, `an ordinary transfer still works (token ${movable.tokenId})`);
    }
  }
} finally {
  anvil.kill();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nrehearsal passed');
process.exit(failures.length ? 1 : 0);

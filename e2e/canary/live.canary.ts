import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createPublicClient, formatEther, http, parseEther, type Address } from 'viem';
import { arbitrum, sepolia } from 'viem/chains';

/**
 * Post-deploy canary against the live site and its chain. Read-only: it proves
 * the deployment is wired together without leaving anything on the platform.
 * The chain and contracts come from the release production is built from
 * (`VITE_DEPLOYMENT_RELEASE` in netlify.toml), so it follows a move to Arbitrum.
 */

const SITE = process.env.CANARY_SITE ?? 'https://digitalcarat.io';
/**
 * `minGas` is the operator balance below which the canary fails, which is the
 * low-balance alert: a failed scheduled run emails the repository owner. Sized
 * for a few hundred operator transactions at each chain's usual gas price.
 */
const CHAINS = {
  [sepolia.id]: {
    chain: sepolia,
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    minGas: '0.02',
  },
  [arbitrum.id]: {
    chain: arbitrum,
    rpc: 'https://arbitrum-one-rpc.publicnode.com',
    minGas: '0.002',
  },
} as const;
const FUNCTIONS = process.env.CANARY_FUNCTIONS_URL ?? '';
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

for (const route of ['/', '/marketplace', '/auctions', '/swaps', '/gift']) {
  test(`live ${route} renders without console errors`, async ({ page }) => {
    const errors: string[] = [];
    let gatewayErrors = 0;
    // Third-party throttling (IPFS gateways, public RPC fallbacks) answers 429
    // without CORS headers; the app fails over to the next source. Counted and
    // annotated so the trend is visible, but only app errors fail the canary.
    const isGateway = (text: string) =>
      /ipfs|pinata|dweb\.link|gateway|rpc\.|publicnode|not allowed by Access-Control-Allow-Origin/i.test(
        text,
      );
    page.on('pageerror', (error) => {
      if (isGateway(error.message)) gatewayErrors += 1;
      else errors.push(error.message);
    });
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // The same third-party test as page errors. A public RPC fallback that
      // rate-limits answers 429 without CORS headers, which Chrome logs as
      // "blocked by CORS policy"; the app moves on to the next endpoint. This
      // filter used to miss that wording and failed most scheduled runs.
      if (isGateway(text)) gatewayErrors += 1;
      else if (!/Failed to load resource/.test(text)) errors.push(text);
    });
    test.info().annotations.push({ type: 'third-party-throttling', description: '0' });
    await page.goto(`${SITE}${route}`);
    await expect(page.locator('h1, h2').first()).toBeVisible();
    await expect(page.getByText('Deployment configuration is incomplete')).toHaveCount(0);
    await page.waitForTimeout(3_000);
    test.info().annotations.at(-1)!.description = String(gatewayErrors);
    expect(errors).toEqual([]);
  });
}

interface BaseManifest {
  chainId: number;
  addresses: Record<string, string>;
  implementations: Record<string, string>;
}
interface UpgradeManifest {
  chainId: number;
  upgradeBlock: number;
  proxy: string;
  implementation: string;
}

/** The release production serves, unless the run names one. */
function productionRelease(): string {
  if (process.env.CANARY_RELEASE) return process.env.CANARY_RELEASE;
  const toml = fs.readFileSync(path.join(process.cwd(), 'netlify.toml'), 'utf8');
  const match = toml.match(
    /\[context\.production\.environment\][^[]*?VITE_DEPLOYMENT_RELEASE\s*=\s*"([^"]+)"/,
  );
  if (!match) throw new Error('netlify.toml names no production VITE_DEPLOYMENT_RELEASE');
  return match[1];
}

/**
 * Each proxy's expected implementation: the release's own manifest, then every
 * later upgrade manifest for one of its proxies, in block order. Upgrades are
 * recorded in files of their own, so the release manifest alone goes stale.
 */
function expectedImplementations(
  base: BaseManifest,
  upgrades: UpgradeManifest[],
): Record<string, string> {
  const expected = { ...base.implementations };
  const nameOf = new Map(
    Object.entries(base.addresses).map(([name, address]) => [address.toLowerCase(), name]),
  );
  for (const upgrade of [...upgrades].sort((a, b) => a.upgradeBlock - b.upgradeBlock)) {
    const name = upgrade.chainId === base.chainId && nameOf.get(upgrade.proxy.toLowerCase());
    if (name) expected[name] = upgrade.implementation;
  }
  return expected;
}

test('every upgraded proxy points at the implementation in the manifests', async () => {
  const contractsDir = path.resolve(process.cwd(), process.env.CONTRACTS_DIR ?? '../gemstone');
  const deployments = path.join(contractsDir, 'deployments');
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(deployments, file), 'utf8'));
  const release = productionRelease();
  const base = read(`${release}.json`) as BaseManifest;
  const upgrades = fs
    .readdirSync(deployments)
    .filter((file) => file.endsWith('.json') && file !== `${release}.json`)
    .map(read)
    .filter((manifest): manifest is UpgradeManifest => typeof manifest.proxy === 'string');
  const target = CHAINS[base.chainId as keyof typeof CHAINS];
  if (!target) throw new Error(`Canary has no chain entry for ${base.chainId}`);
  const client = createPublicClient({
    chain: target.chain,
    transport: http(process.env.CANARY_RPC ?? target.rpc),
  });
  for (const [name, expected] of Object.entries(expectedImplementations(base, upgrades))) {
    const slot = await client.getStorageAt({
      address: base.addresses[name] as Address,
      slot: IMPLEMENTATION_SLOT,
    });
    expect(`0x${slot!.slice(-40)}`.toLowerCase(), name).toBe(expected.toLowerCase());
  }
});

test('edge functions answer their CORS preflight', async () => {
  test.skip(!FUNCTIONS, 'CANARY_FUNCTIONS_URL not set');
  for (const name of ['v1-gift-create', 'v1-gift-claim', 'v1-gift-notify', 'v1-siwe-nonce']) {
    const response = await fetch(`${FUNCTIONS}/${name}`, {
      method: 'OPTIONS',
      headers: { origin: SITE, 'access-control-request-method': 'POST' },
    });
    expect(response.status, name).toBeLessThan(300);
  }
});

test('operator wallets hold enough gas', async () => {
  const release = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'deployments/frontend', `${productionRelease()}.json`),
      'utf8',
    ),
  ) as { chainId: number; giftOperator: string };
  const target = CHAINS[release.chainId as keyof typeof CHAINS];
  if (!target) throw new Error(`Canary has no chain entry for ${release.chainId}`);
  const client = createPublicClient({
    chain: target.chain,
    transport: http(process.env.CANARY_RPC ?? target.rpc),
  });
  // The operator signs every server-side transaction; CANARY_WATCH_WALLETS adds
  // the others that pay gas (proof approver, authorizer), comma-separated.
  // Off Sepolia the edge operator is meant to be its own key, which no manifest
  // records, so an unset list would quietly watch the wrong wallet.
  if (release.chainId !== sepolia.id && !process.env.CANARY_WATCH_WALLETS?.trim()) {
    throw new Error('Set CANARY_WATCH_WALLETS to the edge operator and other gas-paying wallets');
  }
  const wallets = [
    release.giftOperator,
    ...(process.env.CANARY_WATCH_WALLETS ?? '').split(',').map((wallet) => wallet.trim()),
  ].filter(Boolean) as Address[];
  const minimum = parseEther(process.env.CANARY_MIN_GAS_ETH ?? target.minGas);
  for (const wallet of new Set(wallets)) {
    const balance = await client.getBalance({ address: wallet });
    test.info().annotations.push({
      type: 'gas-balance',
      description: `${wallet} ${formatEther(balance)} ETH`,
    });
    expect(
      balance,
      `${wallet} holds ${formatEther(balance)} ETH; top it up`,
    ).toBeGreaterThanOrEqual(minimum);
  }
});

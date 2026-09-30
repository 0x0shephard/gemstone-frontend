import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createPublicClient, http, type Address } from 'viem';
import { sepolia } from 'viem/chains';

/**
 * Post-deploy canary against the live site and Sepolia. Read-only: it proves
 * the deployment is wired together without leaving anything on the platform.
 */

const SITE = process.env.CANARY_SITE ?? 'https://digitalcarat.io';
const RPC = process.env.CANARY_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const FUNCTIONS = process.env.CANARY_FUNCTIONS_URL ?? '';
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

for (const route of ['/', '/marketplace', '/auctions', '/swaps', '/gift']) {
  test(`live ${route} renders without console errors`, async ({ page }) => {
    const errors: string[] = [];
    let gatewayErrors = 0;
    const isGateway = (text: string) =>
      /ipfs|pinata|dweb\.link|gateway|not allowed by Access-Control-Allow-Origin/i.test(text);
    page.on('pageerror', (error) => {
      if (isGateway(error.message)) gatewayErrors += 1;
      else errors.push(error.message);
    });
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // Third-party IPFS gateways rate-limit (429, no CORS headers); the app
      // falls back to other gateways. Counted and annotated, not failed on.
      if (/ipfs|pinata|gateway|not allowed by Access-Control-Allow-Origin/i.test(text))
        gatewayErrors += 1;
      else if (!/Failed to load resource/.test(text)) errors.push(text);
    });
    test.info().annotations.push({ type: 'ipfs-gateway-errors', description: '0' });
    await page.goto(`${SITE}${route}`);
    await expect(page.locator('h1, h2').first()).toBeVisible();
    await expect(page.getByText('Deployment configuration is incomplete')).toHaveCount(0);
    await page.waitForTimeout(3_000);
    test.info().annotations.at(-1)!.description = String(gatewayErrors);
    expect(errors).toEqual([]);
  });
}

test('every upgraded proxy points at the implementation in the manifest', async () => {
  const contractsDir = path.resolve(process.cwd(), process.env.CONTRACTS_DIR ?? '../gemstone');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(contractsDir, 'deployments/sepolia.json'), 'utf8'),
  ) as { addresses: Record<string, string>; implementations: Record<string, string> };
  const client = createPublicClient({ chain: sepolia, transport: http(RPC) });
  for (const [name, expected] of Object.entries(manifest.implementations)) {
    const slot = await client.getStorageAt({
      address: manifest.addresses[name] as Address,
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

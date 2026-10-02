import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ipfsProxy = { target: 'https://gateway.pinata.cloud', changeOrigin: true };

const contractModules = [
  'DGENFT',
  'GemRegistry',
  'PaymentTokenRegistry',
  'ReserveManager',
  'Treasury',
  'PrimarySaleAuction',
  'Marketplace',
  'SwapEscrow',
  'RedemptionManager',
  'ComplianceRegistry',
] as const;

const contractEnvironmentKeys: Record<(typeof contractModules)[number], string> = {
  DGENFT: 'VITE_CONTRACT_DGENFT',
  GemRegistry: 'VITE_CONTRACT_GEM_REGISTRY',
  PaymentTokenRegistry: 'VITE_CONTRACT_PAYMENT_TOKEN_REGISTRY',
  ReserveManager: 'VITE_CONTRACT_RESERVE_MANAGER',
  Treasury: 'VITE_CONTRACT_TREASURY',
  PrimarySaleAuction: 'VITE_CONTRACT_PRIMARY_SALE_AUCTION',
  Marketplace: 'VITE_CONTRACT_MARKETPLACE',
  SwapEscrow: 'VITE_CONTRACT_SWAP_ESCROW',
  RedemptionManager: 'VITE_CONTRACT_REDEMPTION_MANAGER',
  ComplianceRegistry: 'VITE_CONTRACT_COMPLIANCE_REGISTRY',
};

interface BuildDeploymentConfig {
  schemaVersion: 1;
  release: string;
  network: string;
  chainId: number;
  deploymentBlock: number;
  giftOperator?: string;
  addresses: Record<(typeof contractModules)[number], string>;
  paymentAssets?: Record<string, string>;
}

function loadDeploymentConfig(release: string): BuildDeploymentConfig | null {
  if (!release) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(release)) {
    throw new Error(`Invalid VITE_DEPLOYMENT_RELEASE: ${release}`);
  }

  const manifestPath = path.resolve(__dirname, 'deployments', 'frontend', `${release}.json`);
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as BuildDeploymentConfig;
  if (
    parsed.schemaVersion !== 1 ||
    parsed.release !== release ||
    !Number.isSafeInteger(parsed.chainId) ||
    parsed.chainId <= 0 ||
    !Number.isSafeInteger(parsed.deploymentBlock) ||
    parsed.deploymentBlock < 0
  ) {
    throw new Error(`Invalid frontend deployment manifest: ${manifestPath}`);
  }

  const addressPattern = /^0x[0-9a-fA-F]{40}$/;
  for (const moduleName of contractModules) {
    if (!addressPattern.test(parsed.addresses?.[moduleName] ?? '')) {
      throw new Error(`Invalid ${moduleName} address in ${manifestPath}`);
    }
  }
  if (parsed.giftOperator && !addressPattern.test(parsed.giftOperator)) {
    throw new Error(`Invalid giftOperator address in ${manifestPath}`);
  }
  for (const [name, address] of Object.entries(parsed.paymentAssets ?? {})) {
    if (!addressPattern.test(address)) {
      throw new Error(`Invalid ${name} address in ${manifestPath}`);
    }
  }
  return parsed;
}

/**
 * Vite serializes every VITE_* value into `import.meta.env`. Override legacy
 * per-address variables when a release is selected so a fresh production
 * bundle does not even carry dead fallback addresses from the developer's
 * local environment or an older Netlify configuration.
 */
function applyDeploymentEnvironment(config: BuildDeploymentConfig): void {
  process.env.VITE_DEPLOYMENT_RELEASE = config.release;
  process.env.VITE_CHAIN_ID = String(config.chainId);
  process.env.VITE_DEPLOYMENT_BLOCK = String(config.deploymentBlock);
  for (const moduleName of contractModules) {
    process.env[contractEnvironmentKeys[moduleName]] = config.addresses[moduleName];
  }
  if (config.paymentAssets?.mockUsdc) {
    process.env.VITE_USDC_ADDRESS = config.paymentAssets.mockUsdc;
  }
  if (config.paymentAssets?.mockUsdcFaucet) {
    process.env.VITE_MUSDC_FAUCET_ADDRESS = config.paymentAssets.mockUsdcFaucet;
  }
}

function buildCommit(): string {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, __dirname, '');
  const deploymentRelease =
    process.env.VITE_DEPLOYMENT_RELEASE?.trim() ??
    frontendEnv.VITE_DEPLOYMENT_RELEASE?.trim() ??
    '';
  const deploymentConfig = loadDeploymentConfig(deploymentRelease);
  if (deploymentConfig) applyDeploymentEnvironment(deploymentConfig);
  if (
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    frontendEnv.VITE_SUPABASE_SERVICE_ROLE_KEY?.trim()
  ) {
    throw new Error(
      'Unsafe client secret detected: remove VITE_SUPABASE_SERVICE_ROLE_KEY. Edge Functions receive SUPABASE_SERVICE_ROLE_KEY server-side.',
    );
  }

  // Local development reuses the working Sepolia RPC from the sibling contracts
  // repository without copying its API key into this repository. Explicit shell,
  // CI, and Netlify VITE_RPC_URL values always take precedence.
  // A loopback RPC from the mode's env files (the end-to-end build) is kept:
  // replacing it would point a local-chain build at real Sepolia.
  const configuredRpc = frontendEnv.VITE_RPC_URL?.trim() ?? '';
  const localRpc = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/.test(configuredRpc);
  if (!process.env.VITE_RPC_URL && !localRpc) {
    const contractsDir = path.resolve(__dirname, process.env.CONTRACTS_DIR ?? '../gemstone');
    const contractsEnv = loadEnv(mode, contractsDir, '');
    const contractsRpc = contractsEnv.SEPOLIA_RPC_URL?.trim();
    if (contractsRpc && URL.canParse(contractsRpc)) {
      const hostname = new URL(contractsRpc).hostname;
      if (hostname === 'eth-sepolia.g.alchemy.com') {
        process.env.VITE_RPC_URL = contractsRpc;
      }
    }
  }

  return {
    plugins: [
      react(),
      ...(deploymentConfig
        ? [
            {
              name: 'deployment-manifest-audit-asset',
              generateBundle() {
                this.emitFile({
                  type: 'asset',
                  fileName: 'deployment-manifest.json',
                  source: `${JSON.stringify(deploymentConfig, null, 2)}\n`,
                });
              },
            },
          ]
        : []),
    ],
    define: {
      __BUILD_COMMIT__: JSON.stringify(buildCommit()),
      __DEPLOYMENT_CONFIG__: JSON.stringify(deploymentConfig),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      proxy: { '/ipfs': ipfsProxy },
    },
    // Same `/ipfs/*` proxy Netlify applies in production (public/_redirects).
    preview: {
      proxy: { '/ipfs': ipfsProxy },
    },
  };
});

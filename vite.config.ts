import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { execSync } from 'node:child_process';

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
    plugins: [react()],
    define: {
      __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
    },
  };
});

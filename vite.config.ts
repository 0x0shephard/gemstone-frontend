import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

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
  if (!process.env.VITE_RPC_URL) {
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

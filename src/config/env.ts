/**
 * Centralized, typed access to Vite env vars. Import from here rather than
 * touching `import.meta.env` directly so missing/optional config is explicit.
 */

const raw = import.meta.env;

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const env = {
  // Chain / RPC — Sepolia (11155111) by default, overridable.
  chainId: num(raw.VITE_CHAIN_ID, 11155111),
  rpcUrl: raw.VITE_RPC_URL ?? '',
  walletConnectProjectId: raw.VITE_WALLETCONNECT_PROJECT_ID ?? '',

  // Auth (Supabase)
  supabaseUrl: raw.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: raw.VITE_SUPABASE_ANON_KEY ?? '',

  // Seller KYC — token must be minted by a backend, never a frontend secret.
  sumsubBackendUrl: raw.VITE_SUMSUB_BACKEND_URL ?? '',

  // Block explorer base (e.g. https://sepolia.etherscan.io)
  explorerBaseUrl: raw.VITE_EXPLORER_BASE_URL ?? 'https://sepolia.etherscan.io',
} as const;

/** True when a value is configured (non-empty). */
export const isConfigured = (v: string): boolean => v.trim().length > 0;

export const authConfigured = isConfigured(env.supabaseUrl) && isConfigured(env.supabaseAnonKey);
export const walletConnectConfigured = isConfigured(env.walletConnectProjectId);

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_RPC_FALLBACK_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_SUPABASE_URL?: string;
  /**
   * Web Push application server key, as an uncompressed P-256 point in base64url.
   *
   * Public by design — it is sent to the push service on every subscribe. The
   * matching private key is a Supabase secret and must never reach the client.
   */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUMSUB_BACKEND_URL?: string;
  readonly VITE_EXPLORER_BASE_URL?: string;
  // Contract module addresses
  readonly VITE_CONTRACT_DGENFT?: string;
  readonly VITE_CONTRACT_GEM_REGISTRY?: string;
  readonly VITE_CONTRACT_PAYMENT_TOKEN_REGISTRY?: string;
  readonly VITE_CONTRACT_RESERVE_MANAGER?: string;
  readonly VITE_CONTRACT_TREASURY?: string;
  readonly VITE_CONTRACT_PRIMARY_SALE_AUCTION?: string;
  readonly VITE_CONTRACT_MARKETPLACE?: string;
  readonly VITE_CONTRACT_SWAP_ESCROW?: string;
  readonly VITE_CONTRACT_REDEMPTION_MANAGER?: string;
  readonly VITE_CONTRACT_COMPLIANCE_REGISTRY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

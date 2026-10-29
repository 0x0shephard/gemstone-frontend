/**
 * The `SEPOLIA_*` secrets predate multi-network deployments. `_shared/chain.ts`
 * still falls back to them when the network-neutral name is missing, which on
 * Arbitrum would mean signing with the Sepolia operator key (still set in
 * production) the moment `OPERATOR_PRIVATE_KEY` was removed or mistyped.
 *
 * Gift and redemption endpoints call these guards before they build a chain
 * client, so off Sepolia a missing network-neutral secret fails closed instead
 * of silently selecting the legacy one.
 */

export const SEPOLIA_CHAIN_ID = 11155111;

export type EnvReader = (name: string) => string | undefined;

const denoEnv: EnvReader = (name) => Deno.env.get(name);

const LEGACY_FALLBACKS = [
  ['RPC_URL', 'SEPOLIA_RPC_URL'],
  ['OPERATOR_PRIVATE_KEY', 'SEPOLIA_OPERATOR_PRIVATE_KEY'],
] as const;

/** `CHAIN_ID`, defaulting to Sepolia exactly as `_shared/chain.ts` does. */
export function configuredChainId(env: EnvReader = denoEnv): number {
  const raw = env('CHAIN_ID')?.trim();
  const chainId = raw ? Number(raw) : SEPOLIA_CHAIN_ID;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error('CHAIN_ID must be a positive integer');
  }
  return chainId;
}

/**
 * Refuses to continue when a `SEPOLIA_*` fallback would be used off Sepolia.
 * Call before `operatorChain()`.
 */
export function assertNoLegacySepoliaFallback(env: EnvReader = denoEnv): void {
  const chainId = configuredChainId(env);
  if (chainId === SEPOLIA_CHAIN_ID) return;
  for (const [name, legacy] of LEGACY_FALLBACKS) {
    if (!env(name)?.trim()) {
      throw new Error(
        `${name} is not configured for chain ${chainId}; the ${legacy} fallback is only allowed on Sepolia`,
      );
    }
  }
}

/** The deployment's read RPC, with the Sepolia fallback only on Sepolia. */
export function deploymentRpcUrl(env: EnvReader = denoEnv): string {
  const configured = env('RPC_URL')?.trim();
  if (configured) return configured;
  const chainId = configuredChainId(env);
  if (chainId === SEPOLIA_CHAIN_ID) {
    const legacy = env('SEPOLIA_RPC_URL')?.trim();
    if (legacy) return legacy;
    throw new Error('RPC_URL is not configured');
  }
  throw new Error(
    `RPC_URL is not configured for chain ${chainId}; the SEPOLIA_RPC_URL fallback is only allowed on Sepolia`,
  );
}

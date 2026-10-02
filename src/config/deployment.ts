/** Public, build-time deployment data selected by `VITE_DEPLOYMENT_RELEASE`. */
export interface EmbeddedDeploymentConfig {
  schemaVersion: 1;
  release: string;
  network: string;
  chainId: number;
  deploymentBlock: number;
  /** Operator EOA that custodies active gift-card NFTs. */
  giftOperator?: string;
  addresses: Record<string, string>;
  paymentAssets?: {
    nativeEth?: string;
    mockUsdc?: string;
    mockUsdcUsdFeed?: string;
    mockUsdcFaucet?: string;
  };
}

/**
 * Injected by Vite from `deployments/frontend/<release>.json`.
 *
 * `null` keeps local/test builds and rollback deployments compatible with the
 * original individual VITE_* variables. Production selects one immutable
 * release so addresses and the deployment block cannot drift independently.
 */
export const embeddedDeploymentConfig = __DEPLOYMENT_CONFIG__;

/** Scope every Supabase surface (PostgREST, Storage and Functions) to a release. */
export function protocolDeploymentHeaders(
  release: string | undefined,
): Record<string, string> | undefined {
  const normalized = release?.trim();
  return normalized ? { 'x-protocol-deployment': normalized } : undefined;
}

/** Wide-range, read-only Sepolia endpoint used for historical log scans. */
export const DEFAULT_LOGS_RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';

/**
 * Wide-range, read-only public endpoints per chain, used only when no dedicated
 * `LOGS_RPC_URL` is configured. Nothing signed and no key is ever sent to them;
 * they serve `eth_getLogs` and block numbers.
 */
export const DEFAULT_LOGS_RPC_URLS: Readonly<Record<number, string>> = {
  11155111: DEFAULT_LOGS_RPC_URL,
  // Arbitrum's own endpoint. PublicNode's free Arbitrum tier serves only recent
  // blocks and refuses older ranges with -32602 "Archive requests require a
  // personal token", which viem reports as "Invalid parameters were provided to
  // the RPC method" — so a scan from the deployment block failed on its first
  // chunk once the deployment was a day old, every run.
  42161: 'https://arb1.arbitrum.io/rpc',
  421614: 'https://arbitrum-sepolia-rpc.publicnode.com',
};

const canonicalRpcUrl = (value: string) => value.trim().replace(/\/+$/, '');

/**
 * A local node (the end-to-end suite runs anvil with Sepolia's chain id). The
 * public Sepolia default must never replace it: it would read the real
 * network's state for the same addresses.
 */
function isLocalRpc(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ['127.0.0.1', 'localhost', '[::1]', 'host.docker.internal'].includes(hostname);
  } catch {
    return false;
  }
}

/**
 * Keep historical scans off the operator RPC.
 *
 * The operator endpoint is optimized for reads and writes but its plan accepts
 * only tiny `eth_getLogs` windows and is billed per request. Treating the same
 * URL as a dedicated logs endpoint makes a successful scheduler fall farther
 * behind every hour, and on Arbitrum One — where `LOGS_RPC_URL` unset used to
 * mean "use the operator RPC" — every sweep's history scan spent the operator's
 * request budget, uncapped, on thousands of narrow windows.
 *
 * Production sets `LOGS_RPC_URL`. Without it, a chain with a known public
 * wide-range endpoint uses that, and only a chain with none falls back to the
 * operator RPC (the scanner then narrows to whatever window it accepts).
 */
export function resolveLogsRpcUrl(
  operatorRpcUrl: string,
  configuredLogsRpcUrl?: string | null,
  chainId = 11155111,
): string {
  if (isLocalRpc(operatorRpcUrl)) return operatorRpcUrl;
  const configured = configuredLogsRpcUrl?.trim();
  if (configured && canonicalRpcUrl(configured) !== canonicalRpcUrl(operatorRpcUrl)) {
    return configured;
  }
  // A public endpoint for one chain can never serve another: the same
  // addresses would read a different network's state.
  const fallback = DEFAULT_LOGS_RPC_URLS[chainId];
  if (fallback) return fallback;
  return operatorRpcUrl;
}

/** Wide-range, read-only Sepolia endpoint used for historical log scans. */
export const DEFAULT_LOGS_RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';

const canonicalRpcUrl = (value: string) => value.trim().replace(/\/+$/, '');

/**
 * Keep historical scans off the operator RPC.
 *
 * The operator endpoint is optimized for reads and writes but its current plan
 * accepts only tiny `eth_getLogs` windows. Treating the same URL as a dedicated
 * logs endpoint makes a successful scheduler fall farther behind every hour.
 */
export function resolveLogsRpcUrl(
  operatorRpcUrl: string,
  configuredLogsRpcUrl?: string | null,
  chainId = 11155111,
): string {
  const configured = configuredLogsRpcUrl?.trim();
  if (configured && canonicalRpcUrl(configured) !== canonicalRpcUrl(operatorRpcUrl)) {
    return configured;
  }
  if (chainId === 11155111) {
    return DEFAULT_LOGS_RPC_URL;
  }
  // A Sepolia endpoint cannot safely be used for another deployment. When an
  // L2 has no dedicated historical endpoint, use its configured RPC and keep
  // the chain correct even if the provider needs smaller scan windows.
  return operatorRpcUrl;
}

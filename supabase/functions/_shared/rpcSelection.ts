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
): string {
  const configured = configuredLogsRpcUrl?.trim();
  if (!configured || canonicalRpcUrl(configured) === canonicalRpcUrl(operatorRpcUrl)) {
    return DEFAULT_LOGS_RPC_URL;
  }
  return configured;
}

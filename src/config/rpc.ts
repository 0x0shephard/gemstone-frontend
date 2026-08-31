import { fallback, http, type Transport } from 'viem';

export const SEPOLIA_PUBLIC_RPC = 'https://11155111.rpc.thirdweb.com';
/**
 * Browser-safe endpoint used for historical event projection.
 *
 * The configured Alchemy free tier is excellent for contract reads but caps
 * `eth_getLogs` at ten blocks. PublicNode accepts 50,000-block windows when one
 * contract is queried at a time, which is the shape used by the projection.
 */
export const SEPOLIA_LOGS_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

export function resolveRpcUrls(
  chainId: number,
  primaryUrl: string,
  configuredFallbackUrl: string,
): string[] {
  const urls = [
    primaryUrl,
    configuredFallbackUrl,
    chainId === 11155111 ? SEPOLIA_PUBLIC_RPC : '',
  ].filter(Boolean);
  return [...new Set(urls)];
}

export function createRpcTransport(urls: string[]): Transport {
  const transports = urls.length
    ? urls.map((url) => http(url, { retryCount: 0, timeout: 10_000 }))
    : [http(undefined, { retryCount: 0, timeout: 10_000 })];

  // Ordered failover rather than latency ranking: the configured endpoint is
  // preferred for its higher rate limits and wider eth_getLogs spans, which
  // ranking would trade away whenever a throttled public endpoint replied faster.
  return transports.length === 1 ? transports[0] : fallback(transports, { retryCount: 0 });
}

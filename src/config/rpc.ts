import { fallback, http, type Transport } from 'viem';

export const SEPOLIA_PUBLIC_RPC = 'https://11155111.rpc.thirdweb.com';

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

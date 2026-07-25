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

  return transports.length === 1
    ? transports[0]
    : fallback(transports, {
        rank: { interval: 30_000, timeout: 2_000 },
        retryCount: 0,
      });
}

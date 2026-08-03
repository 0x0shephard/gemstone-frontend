/**
 * Public gateways tried after the configured one. A gem's `metadataURI` is written
 * once and can never be repointed, so retrieval has to survive any single gateway
 * being slow, rate-limited, or gone.
 */
export const PUBLIC_IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  // `cloudflare-ipfs.com` was retired by Cloudflare and no longer resolves.
  'https://w3s.link/ipfs/',
] as const;

const trimTrailingSlash = (gateway: string): string => gateway.replace(/\/+$/, '');

/** Configured gateway first, then public fallbacks, de-duplicated. */
export function resolveIpfsGateways(configuredGateway: string): string[] {
  return [...new Set([configuredGateway, ...PUBLIC_IPFS_GATEWAYS].filter(Boolean))].map(
    trimTrailingSlash,
  );
}

export const isIpfsUri = (uri: string): boolean => uri.startsWith('ipfs://');

/** Resolves an `ipfs://` URI against a gateway. Other schemes pass through unchanged. */
export function gatewayUrl(gateway: string, uri: string): string {
  if (!isIpfsUri(uri)) return uri;
  const path = uri.slice('ipfs://'.length).replace(/^ipfs\//, '');
  return `${trimTrailingSlash(gateway)}/${path}`;
}

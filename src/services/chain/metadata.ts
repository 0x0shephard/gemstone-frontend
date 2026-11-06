import { env } from '@/config/env';
import { gatewayUrl, isIpfsUri, resolveIpfsGateways } from '@/config/ipfs';

export interface MetadataAttribute {
  trait_type?: string;
  value?: string | number;
}

/**
 * ERC-721 metadata as this protocol writes it, plus the flat keys used by gems
 * registered before the standard shape landed. `metadataURI` is immutable once a
 * gem is registered, so the legacy keys have to stay readable permanently.
 */
export interface Metadata {
  name?: string;
  description?: string;
  image?: string;
  attributes?: MetadataAttribute[];
  certificate_hash?: string;
  // Legacy flat fields.
  type?: string;
  gemstoneType?: string;
  carats?: number;
  caratWeight?: number;
  displayId?: string;
  custodian?: { provider?: string; country?: string };
  custodyProvider?: string;
  custodyCountry?: string;
}

const FETCH_TIMEOUT_MS = 8_000;
const cache = new Map<string, Promise<Metadata>>();

/** Reads a standard `attributes` entry by trait type, case-insensitively. */
export function trait(metadata: Metadata, traitType: string): string | undefined {
  const match = metadata.attributes?.find(
    (attribute) => attribute.trait_type?.toLowerCase() === traitType.toLowerCase(),
  );
  return match?.value === undefined ? undefined : String(match.value);
}

function parseDataUri(uri: string): Metadata {
  const comma = uri.indexOf(',');
  if (comma === -1) throw new Error('Malformed data URI');
  const header = uri.slice(0, comma);
  const payload = uri.slice(comma + 1);
  const decoded = header.includes(';base64') ? atob(payload) : decodeURIComponent(payload);
  return JSON.parse(decoded) as Metadata;
}

async function fetchJson(url: string): Promise<Metadata> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as Metadata;
}

async function load(uri: string): Promise<Metadata> {
  if (uri.startsWith('data:')) return parseDataUri(uri);
  if (!isIpfsUri(uri)) return fetchJson(uri);

  const gateways = resolveIpfsGateways(env.ipfsGateway);
  let lastError: unknown;
  for (const gateway of gateways) {
    try {
      return await fetchJson(gatewayUrl(gateway, uri));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Unresolvable metadata URI: ${uri}`);
}

/**
 * Kept across visits. An `ipfs://` URI names its content, and `metadataURI` is
 * written once, so an entry can never go stale and never needs expiring. Public
 * gateways take seconds per document and every gem card waits on one, so without
 * this each page load repeats that wait. Storage can be blocked or full, and then
 * the document is simply fetched as before.
 */
const STORE_PREFIX = 'dc:metadata:v1:';

function recall(uri: string): Metadata | undefined {
  if (!isIpfsUri(uri)) return undefined;
  try {
    const stored = localStorage.getItem(STORE_PREFIX + uri);
    return stored ? (JSON.parse(stored) as Metadata) : undefined;
  } catch {
    return undefined;
  }
}

function remember(uri: string, metadata: Metadata): void {
  // Only a document that looks like token metadata, so a gateway's own 200 reply
  // is not kept forever.
  if (!isIpfsUri(uri) || !(metadata.name || metadata.attributes)) return;
  try {
    localStorage.setItem(STORE_PREFIX + uri, JSON.stringify(metadata));
  } catch {
    // Blocked or full: this visit still has the in-memory copy.
  }
}

/**
 * Metadata for a gem, memoized by URI. `readGem` runs for every gem on every list
 * view, so without this the same immutable document is refetched dozens of times
 * per page. Failures are evicted so a transient gateway outage is retried rather
 * than cached as an empty record for the session.
 */
export function readMetadata(uri: string): Promise<Metadata> {
  if (!uri) return Promise.resolve({});
  const cached = cache.get(uri);
  if (cached) return cached;

  const stored = recall(uri);
  if (stored) {
    const ready = Promise.resolve(stored);
    cache.set(uri, ready);
    return ready;
  }

  const pending = load(uri)
    .then((metadata) => {
      remember(uri, metadata);
      return metadata;
    })
    .catch((error) => {
      cache.delete(uri);
      if (import.meta.env.DEV) console.warn(`Metadata unavailable for ${uri}`, error);
      return {} as Metadata;
    });
  cache.set(uri, pending);
  return pending;
}

/** Test seam. */
export function clearMetadataCache(): void {
  cache.clear();
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(STORE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: nothing was remembered.
  }
}

/**
 * Public NFT metadata construction and CID verification.
 *
 * Deliberately free of `npm:` specifiers so the logic that decides what gets
 * published permanently is unit-testable outside Deno, in the same way
 * `mvpPricingMath.ts` is split out of `mvpPricing.ts`.
 *
 * `metadataURI` is written once in `GemRegistry.registerGem`, copied into
 * `tokenURI` at mint, and has no setter in either contract. Everything here is
 * therefore irreversible once a gem is registered.
 */

/** Attribute subset needed to describe a gem publicly. */
export interface PublicAttributes {
  name: string;
  gemstoneType?: string;
  origin?: string;
  caratWeight?: number;
  dimensions?: string;
  color?: string;
  clarity?: string;
  cut?: string;
  treatment?: string;
  gradingLab?: string;
}

export interface MetadataAttribute {
  trait_type: string;
  value: string | number;
}

export interface PublicMetadata {
  name: string;
  description: string;
  image?: string;
  attributes: MetadataAttribute[];
}

const DESCRIPTION =
  'Digital Carat Sepolia MVP gemstone submission with test-only automated valuation and custody activation.';

/**
 * Fields that must never reach public metadata. Enforced rather than documented,
 * because publication cannot be undone.
 */
const FORBIDDEN_KEYS = [
  'seller',
  'sellerwallet',
  'owner',
  'email',
  'phone',
  'address',
  'shipping',
  'vault',
  'location',
  'insurance',
  'policy',
  'appraisal',
  'notes',
  'kyc',
];

/**
 * ERC-721 metadata as specified in the contracts repo's off-chain data
 * architecture.
 *
 * Intentionally omits `certificate_hash`. The on-chain certificate hash is the
 * evidence commitment, and that commitment hashes a payload which already
 * contains `metadataUri` — so a document containing the resulting hash would
 * have to exist before the hash that describes it. The cross-link is carried by
 * the commitment instead, which binds the URI directly.
 */
export function buildPublicMetadata(
  attributes: PublicAttributes,
  options: { image?: string } = {},
): PublicMetadata {
  const traits: Array<[string, string | number | undefined]> = [
    ['Gem Type', attributes.gemstoneType],
    ['Carat Weight', attributes.caratWeight],
    ['Origin', attributes.origin],
    ['Dimensions', attributes.dimensions],
    ['Color', attributes.color],
    ['Clarity', attributes.clarity],
    ['Cut', attributes.cut],
    ['Treatment', attributes.treatment],
    ['Certification Lab', attributes.gradingLab],
  ];
  const metadata: PublicMetadata = {
    name: attributes.name,
    description: DESCRIPTION,
    ...(options.image ? { image: options.image } : {}),
    attributes: traits
      .filter(
        (entry): entry is [string, string | number] =>
          entry[1] !== undefined && entry[1] !== null && entry[1] !== '',
      )
      .map(([trait_type, value]) => ({ trait_type, value })),
  };
  assertNoPrivateFields(metadata);
  return metadata;
}

/** Throws if a document carries anything from the private-data deny list. */
export function assertNoPrivateFields(metadata: PublicMetadata): void {
  const leaked = new Set<string>();
  const walk = (value: unknown, key?: string) => {
    if (key && FORBIDDEN_KEYS.some((forbidden) => key.toLowerCase().includes(forbidden))) {
      leaked.add(key);
    }
    if (Array.isArray(value)) {
      value.forEach((child) => walk(child));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) walk(child, childKey);
    }
  };
  walk(metadata);
  // `trait_type` values are labels, not keys, so check them explicitly.
  for (const attribute of metadata.attributes) {
    const label = attribute.trait_type.toLowerCase();
    if (FORBIDDEN_KEYS.some((forbidden) => label.includes(forbidden)))
      leaked.add(attribute.trait_type);
  }
  if (leaked.size > 0) {
    throw new Error(
      `Public metadata must not contain private fields: ${[...leaked].sort().join(', ')}`,
    );
  }
}

/** Inline fallback used while no pinning provider is configured. */
export function dataUri(document: string): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(document)}`;
}

export const isDataUri = (uri: string): boolean => uri.startsWith('data:');
export const ipfsUri = (cid: string): string => `ipfs://${cid}`;

/** CIDv0 (base58, `Qm…`) or CIDv1 (base32 lowercase, `b…`). */
export function isValidCid(cid: string): boolean {
  return /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid) || /^b[a-z2-7]{58,}$/.test(cid);
}

export interface VerificationResult {
  confirmedBy: string[];
  failures: Array<{ gateway: string; reason: string }>;
}

/** Constant-time-irrelevant byte equality; these are public documents, not secrets. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

/**
 * Confirms a CID resolves to exactly the bytes that were published, from more
 * than one independent gateway.
 *
 * A pinning provider reporting success only proves it accepted the upload. This
 * proves the content is retrievable and byte-identical before the CID is written
 * to an immutable on-chain field — or, for an image, before its CID is sealed
 * inside a metadata document that is itself about to become immutable.
 */
export interface VerifyOptions {
  minimumConfirmations?: number;
  /**
   * How many confirmations must come from a gateway that is *not* the pinning
   * provider.
   *
   * This is the check that carries the weight. IPFS is content-addressed, so a
   * single gateway returning bytes that match what we published already
   * disproves the one real risk — that the provider reported a CID describing
   * different content. Additional confirmations are redundancy against a flaky
   * gateway, which is why they may come from the provider's own endpoint.
   */
  minimumIndependentConfirmations?: number;
  /** Gateways operated by the pinning provider. Excluded from the independence count. */
  providerGateways?: readonly string[];
  label?: string;
  /** Passes over the gateway list. Each pass re-tries gateways that have not yet confirmed. */
  attempts?: number;
  /** Backoff before each retry pass, in milliseconds. */
  retryDelayMs?: number;
  /** Injectable for tests, so a retry suite does not actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function verifyPublishedBytes(
  cid: string,
  expected: Uint8Array,
  gateways: readonly string[],
  fetchImpl: typeof fetch,
  options: VerifyOptions = {},
): Promise<VerificationResult> {
  if (!isValidCid(cid)) throw new Error(`Refusing to verify a malformed CID: ${cid}`);

  const {
    minimumConfirmations = 2,
    minimumIndependentConfirmations = 1,
    providerGateways = [],
    label = 'Content',
    /*
     * Read-back runs immediately after pinning, and content needs a moment to
     * propagate to gateways that have never seen it. Public gateways also
     * rate-limit datacenter egress, which is transient. A single pass turned
     * both into a permanent activation failure.
     *
     * The budget is sized against a measurement rather than a guess: a cold
     * fetch of freshly pinned content took ~10s on its own, so the original
     * 4s + 8s of waiting expired before propagation had a chance to finish.
     */
    attempts = 4,
    retryDelayMs = 5_000,
    sleep = defaultSleep,
  } = options;

  const provider = new Set(providerGateways.map((gateway) => gateway.replace(/\/$/, '')));
  const isIndependent = (gateway: string) => !provider.has(gateway.replace(/\/$/, ''));
  const confirmed = new Set<string>();
  const independentCount = () => [...confirmed].filter(isIndependent).length;
  const satisfied = () =>
    confirmed.size >= minimumConfirmations && independentCount() >= minimumIndependentConfirmations;
  let failures: VerificationResult['failures'] = [];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(retryDelayMs * attempt);
    failures = [];

    for (const gateway of gateways) {
      if (confirmed.has(gateway)) continue;
      const url = `${gateway.replace(/\/$/, '')}/${cid}`;
      try {
        // 15s cut off cold DHT lookups, which were measured at ~10s and are
        // precisely the case verification exists to wait for.
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(25_000) });
        if (!response.ok) {
          failures.push({ gateway, reason: `${response.status} ${response.statusText}` });
          continue;
        }
        const body = new Uint8Array(await response.arrayBuffer());
        if (!sameBytes(body, expected)) {
          // Never retried: differing bytes is a correctness failure, not a
          // transient one, and waiting will not change the answer.
          throw new Error(
            `${label} CID ${cid} resolved to different bytes at ${gateway}. Refusing to publish.`,
          );
        }
        confirmed.add(gateway);
        if (satisfied()) return { confirmedBy: [...confirmed], failures };
      } catch (error) {
        if (error instanceof Error && error.message.includes('Refusing to publish')) throw error;
        failures.push({
          gateway,
          reason: error instanceof Error ? error.message : 'Unreachable',
        });
      }
    }
  }

  const detail = failures.map((failure) => `${failure.gateway}: ${failure.reason}`).join('; ');
  throw new Error(
    `${label} CID ${cid} confirmed by ${confirmed.size} of ${minimumConfirmations} required gateways ` +
      `(${independentCount()} of ${minimumIndependentConfirmations} independent) after ${attempts} ` +
      `attempts. ${detail}`,
  );
}

/** Text form of {@link verifyPublishedBytes}, for the canonical JSON document. */
export function verifyPublishedDocument(
  cid: string,
  expected: string,
  gateways: readonly string[],
  fetchImpl: typeof fetch,
  options: VerifyOptions = {},
): Promise<VerificationResult> {
  return verifyPublishedBytes(cid, new TextEncoder().encode(expected), gateways, fetchImpl, {
    label: 'Metadata',
    ...options,
  });
}

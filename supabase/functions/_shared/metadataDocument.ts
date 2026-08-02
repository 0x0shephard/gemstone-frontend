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

/**
 * Confirms a CID resolves to exactly the bytes that were published, from more
 * than one independent gateway.
 *
 * A pinning provider reporting success only proves it accepted the upload. This
 * proves the content is retrievable and byte-identical before the CID is written
 * to an immutable on-chain field.
 */
export async function verifyPublishedDocument(
  cid: string,
  expected: string,
  gateways: readonly string[],
  fetchImpl: typeof fetch,
  minimumConfirmations = 2,
): Promise<VerificationResult> {
  if (!isValidCid(cid)) throw new Error(`Refusing to verify a malformed CID: ${cid}`);

  const result: VerificationResult = { confirmedBy: [], failures: [] };
  for (const gateway of gateways) {
    const url = `${gateway.replace(/\/$/, '')}/${cid}`;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        result.failures.push({ gateway, reason: `${response.status} ${response.statusText}` });
        continue;
      }
      const body = await response.text();
      if (body !== expected) {
        result.failures.push({ gateway, reason: 'Content did not match the published document' });
        continue;
      }
      result.confirmedBy.push(gateway);
      if (result.confirmedBy.length >= minimumConfirmations) return result;
    } catch (error) {
      result.failures.push({
        gateway,
        reason: error instanceof Error ? error.message : 'Unreachable',
      });
    }
  }

  if (result.confirmedBy.length < minimumConfirmations) {
    const detail = result.failures
      .map((failure) => `${failure.gateway}: ${failure.reason}`)
      .join('; ');
    throw new Error(
      `Metadata CID ${cid} confirmed by ${result.confirmedBy.length} of ${minimumConfirmations} required gateways. ${detail}`,
    );
  }
  return result;
}

import { canonicalize } from 'npm:json-canonicalize@1.1.0';
import {
  buildPublicMetadata,
  ipfsUri,
  isValidCid,
  verifyPublishedBytes,
  verifyPublishedDocument,
  type PublicAttributes,
} from './metadataDocument.ts';

/**
 * Publishes public NFT metadata to IPFS and proves it is retrievable before the
 * CID reaches an immutable on-chain field.
 *
 * Pinning is optional: with no credentials configured the caller keeps the
 * inline `data:` URI used by the Sepolia MVP. When credentials *are* present,
 * any failure throws rather than silently degrading, because a gem registered
 * with an unreachable URI can never be corrected.
 */

/**
 * Gateways used for read-back verification. Independent of the pinning provider
 * on purpose: the provider serving content back only proves it accepted it.
 *
 * `cloudflare-ipfs.com` was removed — Cloudflare retired that hostname and it now
 * fails DNS resolution, so it consumed one of the three slots while being
 * incapable of ever confirming.
 *
 * Public gateways rate-limit datacenter egress, which is why verification
 * retries. Operators running real volume should set `IPFS_VERIFICATION_GATEWAYS`
 * to a dedicated gateway; it is tried first.
 */
const VERIFICATION_GATEWAYS = [
  'https://ipfs.io/ipfs',
  'https://dweb.link/ipfs',
  'https://w3s.link/ipfs',
];

/**
 * File pinning, not JSON pinning. A JSON endpoint re-serialises the document
 * server-side, which would change the bytes and defeat read-back verification.
 */
const PIN_ENDPOINT = 'https://api.pinata.cloud/pinning/pinFileToIPFS';

function pinningToken(): string | undefined {
  return Deno.env.get('IPFS_PINNING_JWT')?.trim() || undefined;
}

export function pinningConfigured(): boolean {
  return pinningToken() !== undefined;
}

function verificationGateways(): string[] {
  const configured = Deno.env.get('IPFS_VERIFICATION_GATEWAYS')?.trim();
  const extra = configured
    ? configured
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  return [...new Set([...extra, ...VERIFICATION_GATEWAYS])];
}

/**
 * Uploads exact bytes and returns the provider-reported CID. The CID is not
 * trusted here; `publishMetadata` verifies it against independent gateways.
 */
async function pinBlob(blob: Blob, filename: string, name: string): Promise<string> {
  const token = pinningToken();
  if (!token) throw new Error('IPFS pinning is not configured');

  const form = new FormData();
  form.append('file', blob, filename);
  form.append('pinataMetadata', JSON.stringify({ name }));

  const response = await fetch(PIN_ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(
      `Pinning provider rejected the upload: ${response.status} ${response.statusText}`,
    );
  }
  const body = (await response.json()) as { IpfsHash?: string };
  if (!body.IpfsHash || !isValidCid(body.IpfsHash)) {
    throw new Error('Pinning provider returned no usable CID');
  }
  return body.IpfsHash;
}

function pinDocument(document: string, name: string): Promise<string> {
  return pinBlob(new Blob([document], { type: 'application/json' }), `${name}.json`, name);
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface PublishedImage {
  /** `ipfs://<cid>`, embedded in the metadata document as its `image`. */
  uri: string;
  cid: string;
  confirmedBy: string[];
}

/**
 * Pins a gemstone photograph and proves it is retrievable before its CID is
 * sealed inside the metadata document.
 *
 * This must run *before* {@link publishMetadata}: the image CID is a field of the
 * document, so publishing the document first would fix a metadata CID that
 * referenced nothing. And both must run before `registerGem`, which writes the
 * metadata URI to a field with no setter.
 *
 * Only seller `gem_media` is ever passed here. Certificates stay in their private
 * bucket — they routinely carry the seller's name and the stone's appraisal
 * history, and pinning is irreversible.
 */
export async function publishImage(
  bytes: Uint8Array,
  contentType: string,
  name: string,
): Promise<PublishedImage> {
  const extension = IMAGE_EXTENSIONS[contentType];
  if (!extension) {
    throw new Error(`Refusing to publish an image of unsupported type ${contentType}`);
  }
  if (bytes.byteLength === 0) throw new Error('Refusing to publish an empty image');

  const cid = await pinBlob(new Blob([bytes], { type: contentType }), `${name}.${extension}`, name);
  const { confirmedBy } = await verifyPublishedBytes(cid, bytes, verificationGateways(), fetch, {
    label: 'Image',
  });
  return { uri: ipfsUri(cid), cid, confirmedBy };
}

export interface PublishedMetadata {
  /** Value written to `GemRegistry.registerGem`. */
  uri: string;
  /** Present only when the document was pinned. */
  cid?: string;
  /** Exact bytes published, retained so a lapsed pin can be reconstituted. */
  document: string;
  confirmedBy: string[];
}

/**
 * Builds, pins and verifies the public metadata for a submission.
 *
 * Canonical JSON keeps the bytes — and therefore the CID — stable across
 * republication of identical input.
 */
export async function publishMetadata(
  attributes: PublicAttributes,
  options: { image?: string; name: string },
): Promise<PublishedMetadata> {
  const metadata = buildPublicMetadata(attributes, { image: options.image });
  const document = canonicalize(metadata);

  const cid = await pinDocument(document, options.name);
  const { confirmedBy } = await verifyPublishedDocument(
    cid,
    document,
    verificationGateways(),
    fetch,
  );
  return { uri: ipfsUri(cid), cid, document, confirmedBy };
}

/** Canonical bytes for the inline fallback, so both paths serialise identically. */
export function canonicalDocument(attributes: PublicAttributes, image?: string): string {
  return canonicalize(buildPublicMetadata(attributes, { image }));
}

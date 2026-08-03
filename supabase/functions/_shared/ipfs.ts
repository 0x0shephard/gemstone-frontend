import { canonicalize } from 'npm:json-canonicalize@1.1.0';
import { computeCidV0 } from './cid.ts';
import {
  buildPublicMetadata,
  ipfsUri,
  isValidCid,
  verifyPublishedBytes,
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
 * The pinning provider's own gateway, tried last.
 *
 * Public gateways return 401 to datacenter egress, and Edge Functions run from
 * exactly those IP ranges — so from here two independent confirmations are often
 * unobtainable no matter how many times we retry. This gives the *second*
 * confirmation somewhere reliable to come from while
 * `minimumIndependentConfirmations` still requires the first to be independent,
 * which is the one that actually proves anything.
 */
const PROVIDER_GATEWAYS = ['https://gateway.pinata.cloud/ipfs'];

/** Operator override, then independent publics, then the provider as a fallback. */
function allGateways(): string[] {
  return [...verificationGateways(), ...PROVIDER_GATEWAYS];
}

/**
 * Establishes that `cid` really describes `bytes`, and that the content is
 * fetchable, using whichever proof is available.
 *
 * Where the CID can be derived locally that is the integrity check, and it is
 * stronger than any read-back: a CID is the hash of its content, so a match
 * means the provider cannot be describing anything else. Gateways then only have
 * to demonstrate *liveness*, which any one of them — including the provider's —
 * can do.
 *
 * Only when the CID cannot be derived (content past the single-block limit) does
 * the original rule apply, where an independent gateway has to vouch for bytes
 * we could not verify ourselves.
 */
async function provePublished(
  cid: string,
  bytes: Uint8Array,
  label: string,
): Promise<{ confirmedBy: string[]; verifiedLocally: boolean }> {
  const derived = await computeCidV0(bytes);

  if (derived && derived !== cid) {
    throw new Error(
      `${label} CID mismatch: the pinning provider reported ${cid}, but these bytes are ${derived}. ` +
        'Refusing to publish content the provider has misdescribed.',
    );
  }

  await announce(cid);
  const { confirmedBy } = await verifyPublishedBytes(cid, bytes, allGateways(), fetch, {
    label,
    providerGateways: PROVIDER_GATEWAYS,
    ...(derived
      ? { minimumConfirmations: 1, minimumIndependentConfirmations: 0 }
      : { minimumConfirmations: 2, minimumIndependentConfirmations: 1 }),
  });
  return { confirmedBy, verifiedLocally: Boolean(derived) };
}

/**
 * Pulls the CID through the provider's gateway once, before verification runs.
 *
 * Freshly pinned content is not yet announced to the wider network, so the first
 * public-gateway request has to do a cold DHT lookup. Measured cold, the
 * provider took ~10s and every public gateway then answered in 1–4s.
 *
 * Best effort. A failure here is not a verification failure.
 */
async function announce(cid: string): Promise<void> {
  await Promise.allSettled(
    PROVIDER_GATEWAYS.map(async (gateway) => {
      const response = await fetch(`${gateway.replace(/\/$/, '')}/${cid}`, {
        signal: AbortSignal.timeout(30_000),
      });
      // Drain the body so the connection completes and the content is really pulled.
      await response.arrayBuffer().catch(() => undefined);
    }),
  );
}

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
  const { confirmedBy } = await provePublished(cid, bytes, 'Image');
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
  const { confirmedBy } = await provePublished(cid, new TextEncoder().encode(document), 'Metadata');
  return { uri: ipfsUri(cid), cid, document, confirmedBy };
}

/** Canonical bytes for the inline fallback, so both paths serialise identically. */
export function canonicalDocument(attributes: PublicAttributes, image?: string): string {
  return canonicalize(buildPublicMetadata(attributes, { image }));
}

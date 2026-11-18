import { getAddress, keccak256, toBytes } from 'npm:viem@2';
import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import {
  assertOperatorChain,
  dgeNftAbi,
  dgeNftAddress,
  operatorChain,
  writeAndConfirm,
} from '../_shared/chain.ts';
import { requireProtocolDeployment } from '../_shared/deployment.ts';
import {
  pinningConfigured,
  publishCorrectedMetadata,
  publishImage,
  readPublishedDocument,
} from '../_shared/ipfs.ts';
import { assertNoLegacySepoliaFallback } from '../_shared/legacySepoliaEnv.ts';
import { replaceMetadataImage } from '../_shared/metadataDocument.ts';
import { MissingCapabilityError, operationalMembership } from '../_shared/operations.ts';

/**
 * Replaces a minted token's picture (admins only).
 *
 *   inspect  { tokenId }                         current URIs and image, and whether
 *                                                the operator may edit metadata yet
 *   replace  { tokenId, image, contentType }     pin the new photo, pin a copy of the
 *                                                token's metadata with only `image`
 *                                                changed, then `DGENFT.setTokenURI`
 *
 * Needs the DGENFT metadata upgrade and `METADATA_ROLE` granted to the operator
 * wallet by the Safe. The registry keeps the URI the gem was registered with.
 */

const METADATA_ROLE = keccak256(toBytes('METADATA_ROLE'));
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function decodeBase64(value: string): Uint8Array {
  const payload = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  const binary = atob(payload);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const admin = adminClient();
    await requireProtocolDeployment(admin, request);
    const user = await requireUser(request);
    const membership = await operationalMembership(admin, user.id, 'admin.correct');
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? 'inspect');

    const rawTokenId = String(body.tokenId ?? '').trim();
    if (!/^[1-9]\d{0,9}$/.test(rawTokenId)) return json({ error: 'Enter a token number' }, 400);
    const tokenId = BigInt(rawTokenId);

    assertNoLegacySepoliaFallback();
    const chain = operatorChain();
    await assertOperatorChain(chain);
    const nft = dgeNftAddress();
    const operator = getAddress(chain.account.address);

    const [owner, tokenUri, gemId, canEdit] = (await Promise.all([
      chain.publicClient.readContract({
        address: nft,
        abi: dgeNftAbi,
        functionName: 'ownerOf',
        args: [tokenId],
      }),
      chain.publicClient.readContract({
        address: nft,
        abi: dgeNftAbi,
        functionName: 'tokenURI',
        args: [tokenId],
      }),
      chain.publicClient.readContract({
        address: nft,
        abi: dgeNftAbi,
        functionName: 'tokenGem',
        args: [tokenId],
      }),
      chain.publicClient
        .readContract({
          address: nft,
          abi: dgeNftAbi,
          functionName: 'hasRole',
          args: [METADATA_ROLE, operator],
        })
        .catch(() => false),
    ]).catch((error: unknown) => {
      throw new Error(
        `Token #${rawTokenId} could not be read: ${safeErrorMessage(error, 'not found')}`,
      );
    })) as [string, string, bigint, boolean];

    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(await readPublishedDocument(tokenUri)) as Record<string, unknown>;
    } catch {
      // Inspect still answers; replace below refuses without a readable document.
    }

    const summary = {
      tokenId: rawTokenId,
      gemId: gemId.toString(),
      owner: getAddress(owner),
      tokenUri,
      name: typeof current.name === 'string' ? current.name : null,
      image: typeof current.image === 'string' ? current.image : null,
      canEdit,
      operator,
    };
    if (action === 'inspect') return json(summary);
    if (action !== 'replace') return json({ error: 'Unknown action' }, 400);

    if (!canEdit) {
      return json(
        {
          error:
            'The operator wallet does not hold METADATA_ROLE yet. The Safe must upgrade DGENFT and grant it first.',
        },
        409,
      );
    }
    if (!pinningConfigured()) return json({ error: 'IPFS pinning is not configured' }, 503);
    if (!summary.name)
      return json({ error: 'The token’s current metadata could not be read' }, 502);

    const contentType = String(body.contentType ?? '');
    if (!CONTENT_TYPES.has(contentType)) {
      return json({ error: 'Upload a JPEG, PNG or WebP image' }, 400);
    }
    const bytes = decodeBase64(String(body.image ?? ''));
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      return json({ error: 'The image must be between 1 byte and 6 MB' }, 400);
    }

    const label = `dc-token-${rawTokenId}-${Date.now()}`;
    const image = await publishImage(bytes, contentType, `${label}-image`);
    const metadata = replaceMetadataImage(JSON.stringify(current), image.uri);
    const published = await publishCorrectedMetadata(
      metadata as unknown as Record<string, unknown>,
      `${label}-metadata`,
    );

    const transactionHash = await writeAndConfirm(chain, {
      address: nft,
      abi: dgeNftAbi,
      functionName: 'setTokenURI',
      args: [tokenId, published.uri],
    });

    await audit(user.id, 'token.picture_replaced', 'token', rawTokenId, {
      gemId: summary.gemId,
      previousTokenUri: tokenUri,
      previousImage: summary.image,
      tokenUri: published.uri,
      image: image.uri,
      transactionHash,
      organizationId: membership.organizationId,
    });

    return json({
      ...summary,
      tokenUri: published.uri,
      image: image.uri,
      previousImage: summary.image,
      transactionHash,
    });
  } catch (error) {
    if (error instanceof MissingCapabilityError) return json({ error: 'Not found' }, 404);
    const message = safeErrorMessage(error, 'The picture could not be replaced');
    return json({ error: message }, /session|authorization/i.test(message) ? 401 : 400);
  }
});

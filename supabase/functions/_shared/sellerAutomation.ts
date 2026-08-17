import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getAddress, isAddressEqual, parseEventLogs, type Address, type Hash } from 'npm:viem@2';
import { audit, sha256 } from './auth.ts';
import { createCommitment } from './commitment.ts';
import { safeErrorMessage } from './errors.ts';
import {
  assertOperatorChain,
  gemRegistryAbi,
  operatorChain,
  primarySaleAbi,
  writeAndConfirm,
} from './chain.ts';
import { createMvpValuation } from './mvpPricing.ts';
import {
  pinningConfigured,
  publishImage,
  publishMetadata,
  type PublishedImage,
  type PublishedMetadata,
} from './ipfs.ts';
import { isDataUri, type PublicAttributes } from './metadataDocument.ts';

type AdminClient = SupabaseClient;

interface SellerSubmission {
  id: string;
  seller_id: string;
  seller_wallet: string;
  attributes: Record<string, unknown> & { caratWeight: number };
  sale_mode: 'buy_now' | 'auction';
  metadata_uri: string;
  metadata_cid: string | null;
  primary_image_evidence_id: string | null;
  primary_image_cid: string | null;
  status: string;
  approved_at: string;
  certificate_hash: Hash | null;
  canonical_payload: string | null;
  commitment_nonce: string | null;
  valuation_method: string | null;
  approved_valuation_usd: string | null;
  valuation_hash: Hash | null;
  valuation_matrix_hash: Hash | null;
  valuation_canonical_payload: string | null;
  valuation_nonce: string | null;
  onchain_gem_id: string | null;
  activation_attempts: number;
  activation_started_at: string | null;
  /** Set as soon as `registerGem` is broadcast, so recovery can be exact. */
  registration_tx_hash: string | null;
  /** Chain height before the first broadcast; the floor for a recovery scan. */
  registration_scan_from_block: number | null;
}

const sellerColumns =
  'id,seller_id,seller_wallet,attributes,sale_mode,metadata_uri,metadata_cid,primary_image_evidence_id,primary_image_cid,status,approved_at,certificate_hash,canonical_payload,commitment_nonce,valuation_method,approved_valuation_usd,valuation_hash,valuation_matrix_hash,valuation_canonical_payload,valuation_nonce,onchain_gem_id,activation_attempts,activation_started_at,registration_tx_hash,registration_scan_from_block';

async function loadSubmission(admin: AdminClient, submissionId: string): Promise<SellerSubmission> {
  const { data, error } = await admin
    .from('seller_submissions')
    .select(sellerColumns)
    .eq('id', submissionId)
    .single();
  if (error || !data) throw error ?? new Error('Seller submission not found');
  return data as SellerSubmission;
}

/**
 * The `gem_media` row whose photograph becomes the public NFT image.
 *
 * The grader's choice wins; the earliest upload is the fallback for the
 * automated path, which has no grader. Certificates are never eligible — they
 * carry the seller's name and appraisal history, and pinning cannot be undone.
 */
async function resolvePrimaryImage(
  admin: AdminClient,
  submission: SellerSubmission,
): Promise<{ bytes: Uint8Array; contentType: string; evidenceId: string } | undefined> {
  const query = admin
    .from('evidence_files')
    .select('id,bucket,object_path,mime_type')
    .eq('submission_id', submission.id)
    .eq('category', 'gem_media');

  const { data: media, error } = submission.primary_image_evidence_id
    ? await query.eq('id', submission.primary_image_evidence_id).maybeSingle()
    : await query.order('created_at').limit(1).maybeSingle();
  if (error) throw error;
  if (!media) {
    // An explicit choice that cannot be found is a mismatch worth failing on; a
    // submission with no media at all simply publishes without an image.
    if (submission.primary_image_evidence_id) {
      throw new Error('The selected primary image is not gemstone media for this submission');
    }
    return undefined;
  }

  const { data: blob, error: downloadError } = await admin.storage
    .from(media.bucket)
    .download(media.object_path);
  if (downloadError || !blob) {
    throw new Error(`Primary image could not be read from private storage: ${media.object_path}`);
  }
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    contentType: media.mime_type,
    evidenceId: media.id,
  };
}

/**
 * Certificate digests, computed from the stored bytes rather than read.
 *
 * `evidence_files.sha256` is written by the seller — the insert policy checks
 * ownership and category and says nothing about the digest matching the object.
 * Committing that value on chain therefore recorded whatever the seller claimed
 * their certificate hashed to, which is the one thing the commitment exists to
 * make impossible: the certificate could be swapped afterwards and the
 * commitment would still verify against the substitute.
 *
 * Hashing here costs a download per certificate, once, at activation. The stored
 * column is left alone: it is still useful for deduplication and for spotting a
 * client that computed it wrongly, and overwriting it would destroy the evidence
 * that the two ever disagreed.
 */
async function certificateDigestsFromStorage(
  admin: AdminClient,
  submissionId: string,
): Promise<string[]> {
  const { data: files, error } = await admin
    .from('evidence_files')
    .select('id,bucket,object_path,sha256')
    .eq('submission_id', submissionId)
    .eq('category', 'certificate');
  if (error) throw error;

  const digests: string[] = [];
  for (const file of files ?? []) {
    const { data: blob, error: downloadError } = await admin.storage
      .from(file.bucket)
      .download(file.object_path);
    if (downloadError || !blob) {
      throw new Error(`Certificate could not be read from private storage: ${file.object_path}`);
    }
    const actual = await sha256(new Uint8Array(await blob.arrayBuffer()));
    /*
     * A mismatch is refused rather than silently corrected. It means either a
     * client that hashes incorrectly or a deliberate substitution, and neither
     * should be resolved by an automated process quietly committing whichever
     * value it happens to trust.
     */
    if (file.sha256 && file.sha256.toLowerCase() !== actual) {
      throw new Error(
        `Certificate ${file.object_path} does not match its recorded digest; activation stopped`,
      );
    }
    digests.push(actual);
  }
  // Sorted here because the commitment is order-sensitive and this no longer
  // arrives pre-ordered from the database.
  return digests.sort();
}

export async function prepareSellerSubmission(
  admin: AdminClient,
  submissionId: string,
  options: { allowAutomaticValuation?: boolean } = {},
): Promise<SellerSubmission> {
  let submission = await loadSubmission(admin, submissionId);
  if (!['approved', 'registered'].includes(submission.status)) {
    throw new Error('Only approved submissions can be prepared for activation');
  }

  let evidence: { hash: Hash; canonicalPayload: string; nonce: `0x${string}` } | undefined;
  let publication: PublishedMetadata | undefined;
  let image: PublishedImage | undefined;
  let imageEvidenceId: string | undefined;
  if (!submission.certificate_hash || !submission.canonical_payload) {
    const certificateDigests = await certificateDigestsFromStorage(admin, submissionId);
    if (certificateDigests.length === 0 || !submission.metadata_uri) {
      throw new Error('Approved certificates and metadata URI are required');
    }

    /*
     * Publish before committing. The commitment binds `metadataUri`, and
     * `registerGem` writes that same URI to a field with no setter, so this is
     * the last point at which the published document can still change.
     *
     * Image first, then the document that references its CID, then the
     * commitment over the document's URI. Each step is verified against
     * independent gateways before the next depends on it.
     *
     * Only inline URIs are replaced: once a submission carries a CID the
     * document is already public and immutable. Without pinning credentials the
     * inline document is kept, which is the Sepolia MVP path — and that path has
     * no image, because there is nowhere public to host one.
     */
    let metadataUri = submission.metadata_uri;
    if (pinningConfigured() && isDataUri(metadataUri)) {
      const primary = await resolvePrimaryImage(admin, submission);
      if (primary) {
        image = await publishImage(
          primary.bytes,
          primary.contentType,
          `digital-carat-gem-${submissionId}`,
        );
        imageEvidenceId = primary.evidenceId;
      }
      publication = await publishMetadata(submission.attributes as unknown as PublicAttributes, {
        name: `digital-carat-submission-${submissionId}`,
        image: image?.uri,
      });
      metadataUri = publication.uri;
    }

    evidence = createCommitment({
      submissionId,
      sellerWallet: submission.seller_wallet,
      approvedAttributes: submission.attributes,
      saleMode: submission.sale_mode,
      certificateDigests,
      metadataUri,
      timestamp: new Date().toISOString(),
    });
  }

  const valuationMissing =
    !submission.valuation_hash ||
    !submission.valuation_matrix_hash ||
    !submission.approved_valuation_usd;

  /*
   * The automated figure is a test-only $500/ct rule and `approvedValuationUsd`
   * has no setter. Under lab gating a missing valuation means the grading step
   * did not run, so this fails loudly rather than quietly writing the fallback
   * price a lab was supposed to replace.
   */
  if (valuationMissing && !options.allowAutomaticValuation) {
    throw new Error('This submission has no graded valuation; it cannot be activated');
  }

  const valuation = valuationMissing
    ? createMvpValuation({
        submissionId,
        sellerWallet: submission.seller_wallet,
        attributes: submission.attributes,
        saleMode: submission.sale_mode,
      })
    : undefined;

  if (evidence || valuation) {
    const { error } = await admin
      .from('seller_submissions')
      .update({
        ...(evidence
          ? {
              certificate_hash: evidence.hash,
              canonical_payload: evidence.canonicalPayload,
              commitment_nonce: evidence.nonce,
            }
          : {}),
        ...(publication
          ? {
              metadata_uri: publication.uri,
              metadata_cid: publication.cid,
              metadata_document: publication.document,
              metadata_published_at: new Date().toISOString(),
            }
          : {}),
        ...(image
          ? {
              primary_image_evidence_id: imageEvidenceId,
              primary_image_cid: image.cid,
              primary_image_published_at: new Date().toISOString(),
            }
          : {}),
        ...(valuation
          ? {
              valuation_method: valuation.method,
              approved_valuation_usd: valuation.approvedValuationUsd.toString(),
              valuation_hash: valuation.valuationHash,
              valuation_matrix_hash: valuation.valuationMatrixHash,
              valuation_canonical_payload: valuation.canonicalPayload,
              valuation_nonce: valuation.nonce,
            }
          : {}),
        activation_state: 'prepared',
        activation_error: null,
      })
      .eq('id', submissionId);
    if (error) throw error;
    submission = await loadSubmission(admin, submissionId);
    await audit(
      submission.seller_id,
      'seller.activation_prepared',
      'seller_submission',
      submissionId,
      {
        valuationMethod: submission.valuation_method,
        approvedValuationUsd: submission.approved_valuation_usd,
        metadataCid: publication?.cid ?? null,
        metadataConfirmedBy: publication?.confirmedBy ?? null,
        imageCid: image?.cid ?? null,
        imageConfirmedBy: image?.confirmedBy ?? null,
      },
    );
  }
  return submission;
}

/**
 * The gem id from a registration whose receipt was already recorded.
 *
 * Exact where the log scan is a search: the transaction hash names the one
 * transaction that could have registered this stone. Recorded before anything
 * else is written, so it survives the failure the scan exists to recover from.
 */
async function gemIdFromRecordedTx(
  chain: ReturnType<typeof operatorChain>,
  submission: SellerSubmission,
): Promise<bigint | undefined> {
  const hash = submission.registration_tx_hash;
  if (!hash) return undefined;
  const receipt = await chain.publicClient
    .getTransactionReceipt({ hash: hash as Hash })
    .catch(() => undefined);
  // A hash the node cannot find is a transaction that never landed — dropped
  // from the mempool, or replaced. Registering again is then correct, so this
  // falls through to the scan rather than failing.
  if (!receipt || receipt.status !== 'success') return undefined;
  const event = parseEventLogs({
    abi: gemRegistryAbi,
    eventName: 'GemRegistered',
    logs: receipt.logs,
  })[0];
  return event?.args.gemId;
}

async function recoverRegisteredGem(
  chain: ReturnType<typeof operatorChain>,
  submission: SellerSubmission,
): Promise<bigint | undefined> {
  const recorded = await gemIdFromRecordedTx(chain, submission);
  if (recorded !== undefined) return recorded;

  const latestBlock = await chain.publicClient.getBlockNumber();
  /*
   * From where the attempt began, not from a fixed distance behind the head.
   *
   * A 128-block floor meant recovery worked for about twenty-five minutes and
   * then silently stopped, so a retry the next morning registered the stone a
   * second time. The registry has no uniqueness guard to catch that.
   */
  const recordedFloor =
    submission.registration_scan_from_block === null ||
    submission.registration_scan_from_block === undefined
      ? undefined
      : BigInt(submission.registration_scan_from_block);
  const fallbackFloor = latestBlock > 127n ? latestBlock - 127n : chain.deploymentBlock;
  const earliestBlock = recordedFloor ?? fallbackFloor;
  const lowerBound = earliestBlock > chain.deploymentBlock ? earliestBlock : chain.deploymentBlock;
  let toBlock = latestBlock;
  while (toBlock >= lowerBound) {
    const candidateFrom = toBlock >= 9n ? toBlock - 9n : 0n;
    const fromBlock = candidateFrom > lowerBound ? candidateFrom : lowerBound;
    const logs = await chain.publicClient.getLogs({
      address: chain.addresses.registry,
      event: {
        type: 'event',
        name: 'GemRegistered',
        inputs: [
          { name: 'gemId', type: 'uint256', indexed: true },
          { name: 'seller', type: 'address', indexed: true },
          { name: 'custodian', type: 'address', indexed: true },
        ],
      },
      args: {
        seller: getAddress(submission.seller_wallet),
        custodian: chain.account.address,
      },
      fromBlock,
      toBlock,
    });
    for (const log of [...logs].reverse()) {
      const gem = (await chain.publicClient.readContract({
        address: chain.addresses.registry,
        abi: gemRegistryAbi,
        functionName: 'getGem',
        args: [log.args.gemId!],
      })) as {
        metadataURI: string;
        certificateHash: Hash;
      };
      if (
        gem.metadataURI === submission.metadata_uri &&
        gem.certificateHash.toLowerCase() === submission.certificate_hash?.toLowerCase()
      ) {
        return log.args.gemId;
      }
    }
    if (fromBlock === lowerBound) break;
    toBlock = fromBlock - 1n;
  }
}

async function persistStep(
  admin: AdminClient,
  submissionId: string,
  values: Record<string, unknown>,
) {
  const { error } = await admin.from('seller_submissions').update(values).eq('id', submissionId);
  if (error) throw error;
  /*
   * Progress renews the lease. Recording a completed step is the one moment we
   * know this activation is alive and still working, so it is the honest place
   * to extend it — rather than claiming a longer lease up front, which would
   * also hold the operator for a run that has already crashed.
   *
   * Failure here is ignored on purpose: the step really did happen, and losing
   * the lease is recoverable while losing the record of the step is not.
   */
  await renewOperatorLease(admin, submissionId);
}

/** Extends the lease, but only for the activation already holding it. */
async function renewOperatorLease(admin: AdminClient, submissionId: string): Promise<void> {
  const now = new Date();
  await admin
    .from('protocol_operator_leases')
    .update({
      expires_at: new Date(now.getTime() + OPERATOR_LEASE_MS).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('lease_name', 'sepolia-seller-activation')
    .eq('holder_id', submissionId);
}

/**
 * How long the operator lease is held before it lapses.
 *
 * Long enough for one slow confirmation, short enough that an activation which
 * dies mid-flight does not block the next one for long. Renewed at every step
 * below, so the total length of an activation does not have to fit inside it —
 * which it did not: five minutes covered a single transaction, and an
 * activation makes five or six. Once the lease lapsed a second activation could
 * claim it and drive the same operator key concurrently, contending for the
 * nonce the lease exists to protect.
 */
const OPERATOR_LEASE_MS = 15 * 60_000;

async function claimOperatorLease(admin: AdminClient, submissionId: string): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OPERATOR_LEASE_MS).toISOString();
  const { data, error } = await admin
    .from('protocol_operator_leases')
    .update({
      holder_id: submissionId,
      expires_at: expiresAt,
      updated_at: now.toISOString(),
    })
    .eq('lease_name', 'sepolia-seller-activation')
    .or(`expires_at.lt.${now.toISOString()},holder_id.eq.${submissionId}`)
    .select('lease_name')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Sepolia seller operator is busy; retry activation shortly');
}

async function releaseOperatorLease(admin: AdminClient, submissionId: string): Promise<void> {
  await admin
    .from('protocol_operator_leases')
    .update({
      holder_id: null,
      expires_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('lease_name', 'sepolia-seller-activation')
    .eq('holder_id', submissionId);
}

/**
 * Registers, custodies, verifies and lists a submission on-chain.
 *
 * Every step is idempotent and its transaction hash recorded, so a partial run
 * can be retried without registering a second gem. `allowAutomaticValuation` is
 * the `mvp-auto` path's opt-in to the test-only $500/ct fallback; lab-graded
 * submissions arrive with a valuation already written and must never reach it.
 */
export async function activateSellerSubmission(
  admin: AdminClient,
  submissionId: string,
  options: { allowAutomaticValuation?: boolean } = {},
) {
  /*
   * Preparation runs inside the failure handling, not before it. It pins to IPFS
   * and verifies read-back, which is the step most likely to fail on a bad day —
   * and when it threw from outside this guard the row kept `activation_state =
   * 'pending'` with a null `activation_error`, so the stall was invisible and the
   * seller's retry button never appeared.
   */
  let submission: SellerSubmission;
  try {
    submission = await prepareSellerSubmission(admin, submissionId, options);
    if (
      !submission.certificate_hash ||
      !submission.valuation_hash ||
      !submission.valuation_matrix_hash ||
      !submission.approved_valuation_usd
    ) {
      throw new Error('Seller activation package is incomplete');
    }
  } catch (error) {
    const message = safeErrorMessage(error, 'Seller activation could not be prepared');
    await persistStep(admin, submissionId, {
      activation_state: 'failed',
      activation_error: message.slice(0, 2_000),
      activation_started_at: null,
    });
    throw error;
  }
  const chain = operatorChain();
  await assertOperatorChain(chain);
  const seller = getAddress(submission.seller_wallet);
  const priceUsd = BigInt(submission.approved_valuation_usd);
  let latestHash: Hash | undefined;
  const startedAt = new Date().toISOString();
  const staleBefore = Date.now() - 5 * 60_000;
  let claim = admin
    .from('seller_submissions')
    .update({
      activation_state: 'registering',
      activation_started_at: startedAt,
      activation_error: null,
      activation_attempts: submission.activation_attempts + 1,
    })
    .eq('id', submissionId);
  if (
    submission.activation_started_at &&
    new Date(submission.activation_started_at).getTime() < staleBefore
  ) {
    claim = claim.eq('activation_started_at', submission.activation_started_at);
  } else {
    claim = claim.is('activation_started_at', null);
  }
  const { data: claimed, error: claimError } = await claim.select('id').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) throw new Error('Seller activation is already in progress');

  let operatorLeaseClaimed = false;
  try {
    await claimOperatorLease(admin, submissionId);
    operatorLeaseClaimed = true;
    const sellerApproved = await chain.publicClient.readContract({
      address: chain.addresses.registry,
      abi: gemRegistryAbi,
      functionName: 'sellerApproved',
      args: [seller],
    });
    if (!sellerApproved) {
      latestHash = await writeAndConfirm(chain, {
        address: chain.addresses.registry,
        abi: gemRegistryAbi,
        functionName: 'setSellerApproval',
        args: [seller, true],
      });
    }

    let gemId = submission.onchain_gem_id ? BigInt(submission.onchain_gem_id) : undefined;
    if (!gemId && submission.activation_attempts > 0) {
      gemId = await recoverRegisteredGem(chain, submission);
    }
    if (!gemId) {
      /*
       * Two writes before the registration, both cheap and both about being able
       * to find it again afterwards.
       *
       * The floor is recorded first because it must survive the broadcast
       * itself failing to return. `registerGem` is not idempotent and the
       * registry enforces no uniqueness, so a registration that lands while this
       * process dies is a stone that gets registered twice unless the retry can
       * locate it.
       */
      if (
        submission.registration_scan_from_block === null ||
        submission.registration_scan_from_block === undefined
      ) {
        await persistStep(admin, submissionId, {
          registration_scan_from_block: Number(await chain.publicClient.getBlockNumber()),
        });
      }

      latestHash = await writeAndConfirm(chain, {
        address: chain.addresses.registry,
        abi: gemRegistryAbi,
        functionName: 'registerGem',
        args: [seller, chain.account.address, submission.metadata_uri, submission.certificate_hash],
      });

      // The hash on its own, before anything that could fail. It was previously
      // written in the same statement as the gem id, so the one value that makes
      // recovery exact was lost by precisely the failure it was needed for.
      await persistStep(admin, submissionId, { registration_tx_hash: latestHash });

      const receipt = await chain.publicClient.getTransactionReceipt({ hash: latestHash });
      const event = parseEventLogs({
        abi: gemRegistryAbi,
        eventName: 'GemRegistered',
        logs: receipt.logs,
      })[0];
      gemId = event?.args.gemId;
      if (!gemId) throw new Error('GemRegistered event was not found');
      await persistStep(admin, submissionId, {
        onchain_gem_id: gemId.toString(),
        activation_state: 'registered',
      });
    } else if (!submission.onchain_gem_id) {
      await persistStep(admin, submissionId, {
        onchain_gem_id: gemId.toString(),
        activation_state: 'registered',
      });
    }

    let gem = (await chain.publicClient.readContract({
      address: chain.addresses.registry,
      abi: gemRegistryAbi,
      functionName: 'getGem',
      args: [gemId],
    })) as { seller: Address; custodian: Address; status: number };
    if (
      !isAddressEqual(gem.seller, seller) ||
      !isAddressEqual(gem.custodian, chain.account.address)
    ) {
      throw new Error('Recovered on-chain gem does not match the activation package');
    }

    if (gem.status === 1) {
      latestHash = await writeAndConfirm(chain, {
        address: chain.addresses.registry,
        abi: gemRegistryAbi,
        functionName: 'confirmCustody',
        args: [gemId],
      });
      await persistStep(admin, submissionId, {
        custody_tx_hash: latestHash,
        activation_state: 'custody_confirmed',
      });
      gem = { ...gem, status: 2 };
    }
    if (gem.status === 2) {
      latestHash = await writeAndConfirm(chain, {
        address: chain.addresses.registry,
        abi: gemRegistryAbi,
        functionName: 'verifyGem',
        args: [gemId, submission.valuation_hash, submission.valuation_matrix_hash, priceUsd],
      });
      await persistStep(admin, submissionId, {
        valuation_tx_hash: latestHash,
        activation_state: 'verified',
      });
      gem = { ...gem, status: 3 };
    }
    if (gem.status === 3) {
      latestHash = await writeAndConfirm(chain, {
        address: chain.addresses.registry,
        abi: gemRegistryAbi,
        functionName: 'listGem',
        args: [gemId, priceUsd, submission.sale_mode === 'auction' ? 2 : 1],
      });
      await persistStep(admin, submissionId, {
        listing_tx_hash: latestHash,
        activation_state: 'listed',
      });
      gem = { ...gem, status: 4 };
    }
    if (submission.sale_mode === 'auction' && gem.status === 4) {
      const auction = await chain.publicClient.readContract({
        address: chain.addresses.primarySale,
        abi: primarySaleAbi,
        functionName: 'auctions',
        args: [gemId],
      });
      if (!auction[0]) {
        latestHash = await writeAndConfirm(chain, {
          address: chain.addresses.primarySale,
          abi: primarySaleAbi,
          functionName: 'createDailyAuction',
          args: [gemId, priceUsd],
        });
        await persistStep(admin, submissionId, {
          auction_tx_hash: latestHash,
          activation_state: 'auction_created',
        });
      }
    }

    await persistStep(admin, submissionId, {
      status: 'registered',
      activation_state: submission.sale_mode === 'auction' ? 'auction_created' : 'listed',
      activation_tx_hash: latestHash,
      activation_error: null,
      activation_started_at: null,
      activated_at: new Date().toISOString(),
    });
    await audit(
      submission.seller_id,
      'seller.activation_completed',
      'seller_submission',
      submissionId,
      {
        gemId: gemId.toString(),
        approvedValuationUsd: priceUsd.toString(),
        saleMode: submission.sale_mode,
        transactionHash: latestHash,
      },
    );
    submission = await loadSubmission(admin, submissionId);
    return {
      submissionId,
      status: submission.status,
      activationState: submission.sale_mode === 'auction' ? 'auction_created' : 'listed',
      onchainGemId: gemId.toString(),
      approvedValuationUsd: priceUsd.toString(),
      valuationMethod: submission.valuation_method,
      transactionHash: latestHash,
    };
  } catch (error) {
    const message = safeErrorMessage(error, 'Seller activation failed');
    await persistStep(admin, submissionId, {
      activation_state: 'failed',
      activation_error: message.slice(0, 2_000),
      activation_started_at: null,
    });
    await audit(
      submission.seller_id,
      'seller.activation_failed',
      'seller_submission',
      submissionId,
      {
        error: message,
      },
    );
    throw error;
  } finally {
    if (operatorLeaseClaimed) await releaseOperatorLease(admin, submissionId);
  }
}

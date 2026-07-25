import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getAddress, isAddressEqual, parseEventLogs, type Address, type Hash } from 'npm:viem@2';
import { audit } from './auth.ts';
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

type AdminClient = SupabaseClient;

interface SellerSubmission {
  id: string;
  seller_id: string;
  seller_wallet: string;
  attributes: Record<string, unknown> & { caratWeight: number };
  sale_mode: 'buy_now' | 'auction';
  metadata_uri: string;
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
}

const sellerColumns =
  'id,seller_id,seller_wallet,attributes,sale_mode,metadata_uri,status,approved_at,certificate_hash,canonical_payload,commitment_nonce,valuation_method,approved_valuation_usd,valuation_hash,valuation_matrix_hash,valuation_canonical_payload,valuation_nonce,onchain_gem_id,activation_attempts,activation_started_at';

async function loadSubmission(admin: AdminClient, submissionId: string): Promise<SellerSubmission> {
  const { data, error } = await admin
    .from('seller_submissions')
    .select(sellerColumns)
    .eq('id', submissionId)
    .single();
  if (error || !data) throw error ?? new Error('Seller submission not found');
  return data as SellerSubmission;
}

export async function prepareSellerSubmission(
  admin: AdminClient,
  submissionId: string,
): Promise<SellerSubmission> {
  let submission = await loadSubmission(admin, submissionId);
  if (!['approved', 'registered'].includes(submission.status)) {
    throw new Error('Only approved submissions can be prepared for activation');
  }

  let evidence: { hash: Hash; canonicalPayload: string; nonce: `0x${string}` } | undefined;
  if (!submission.certificate_hash || !submission.canonical_payload) {
    const { data: files, error } = await admin
      .from('evidence_files')
      .select('category,sha256')
      .eq('submission_id', submissionId)
      .order('sha256');
    if (error) throw error;
    const certificateDigests = (files ?? [])
      .filter((file) => file.category === 'certificate')
      .map((file) => file.sha256);
    if (certificateDigests.length === 0 || !submission.metadata_uri) {
      throw new Error('Approved certificates and metadata URI are required');
    }
    evidence = createCommitment({
      submissionId,
      sellerWallet: submission.seller_wallet,
      approvedAttributes: submission.attributes,
      saleMode: submission.sale_mode,
      certificateDigests,
      metadataUri: submission.metadata_uri,
      timestamp: new Date().toISOString(),
    });
  }

  const valuation =
    !submission.valuation_hash ||
    !submission.valuation_matrix_hash ||
    !submission.approved_valuation_usd
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
      },
    );
  }
  return submission;
}

async function recoverRegisteredGem(
  chain: ReturnType<typeof operatorChain>,
  submission: SellerSubmission,
): Promise<bigint | undefined> {
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
    fromBlock: chain.deploymentBlock,
    toBlock: 'latest',
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
}

async function persistStep(
  admin: AdminClient,
  submissionId: string,
  values: Record<string, unknown>,
) {
  const { error } = await admin.from('seller_submissions').update(values).eq('id', submissionId);
  if (error) throw error;
}

async function claimOperatorLease(admin: AdminClient, submissionId: string): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
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

export async function activateSellerSubmission(admin: AdminClient, submissionId: string) {
  let submission = await prepareSellerSubmission(admin, submissionId);
  if (
    !submission.certificate_hash ||
    !submission.valuation_hash ||
    !submission.valuation_matrix_hash ||
    !submission.approved_valuation_usd
  ) {
    throw new Error('Seller activation package is incomplete');
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
    if (!gemId) gemId = await recoverRegisteredGem(chain, submission);
    if (!gemId) {
      latestHash = await writeAndConfirm(chain, {
        address: chain.addresses.registry,
        abi: gemRegistryAbi,
        functionName: 'registerGem',
        args: [seller, chain.account.address, submission.metadata_uri, submission.certificate_hash],
      });
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
        registration_tx_hash: latestHash,
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

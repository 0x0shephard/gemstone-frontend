import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { NotACustodianError, canConfirmCustody, requireVerifier } from '../_shared/verifier.ts';
import { getAddress, isAddress } from 'npm:viem@2';
import { gemRegistryAbi, operatorChain } from '../_shared/chain.ts';
import { requireProtocolDeployment } from '../_shared/deployment.ts';

/**
 * Delivery details for an open redemption, for the custodian who must fulfil it.
 *
 * `redemption_requests` is readable only by its requester, which is right for a
 * table holding someone's name and home address — but it left the custodian
 * unable to see where to send the stone while being the only party who can
 * confirm the handover and burn the token. An irreversible action was on screen
 * with the information needed to take it responsibly deliberately withheld.
 *
 * An endpoint rather than a second RLS policy, for two reasons. A policy would
 * expose every row to every verifier member, where this returns one request at a
 * time and only while it is genuinely open. And each read is written to the
 * audit trail: who looked at an address, and when, is worth being able to answer
 * later.
 */
Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const deployment = await requireProtocolDeployment(admin, request);
    const membership = await requireVerifier(admin, user.id);
    // The same gate as recording an intake. Receiving a stone and releasing one
    // are the two ends of custody, and neither is a grader's business.
    if (!canConfirmCustody(membership)) throw new NotACustodianError();

    const body = (await request.json()) as Record<string, unknown>;
    const tokenId = String(body.tokenId ?? '');
    if (!/^\d+$/.test(tokenId)) return json({ error: 'A numeric token id is required' }, 400);

    const { data: records, error } = await admin
      .from('redemption_requests')
      .select(
        'id,gem_id::text,token_id::text,fulfillment_method,fulfillment_details,status,request_hash,created_at',
      )
      .eq('deployment_id', deployment.id)
      .eq('token_id', tokenId)
      /*
       * Only a live request. A cancelled or fulfilled one is finished business,
       * and its address should stop being readable when it stops being needed
       * rather than remaining available to anyone with a custody role forever.
       */
      .in('status', ['committed', 'onchain_requested'])
      .not('request_hash', 'is', null);
    if (error) throw error;
    if (!records?.length) {
      return json({ error: 'No open redemption request for that token' }, 404);
    }

    const chain = operatorChain();
    let record: (typeof records)[number] | undefined;
    let custodian: string | undefined;
    for (const candidate of records) {
      const gem = (await chain.publicClient.readContract({
        address: chain.addresses.registry,
        abi: gemRegistryAbi,
        functionName: 'getGem',
        args: [BigInt(candidate.gem_id)],
      })) as { custodian: string; redemptionRequestHash: string };
      if (
        candidate.request_hash &&
        gem.redemptionRequestHash.toLowerCase() === String(candidate.request_hash).toLowerCase()
      ) {
        record = candidate;
        custodian = gem.custodian;
        break;
      }
    }
    if (!record || !custodian) {
      return json({ error: 'No delivery record matches the active chain redemption' }, 404);
    }

    const { data: walletLink } = await admin
      .from('wallet_links')
      .select('wallet_address')
      .eq('profile_id', user.id)
      .eq('is_primary', true)
      .not('verified_at', 'is', null)
      .maybeSingle();
    if (
      !walletLink?.wallet_address ||
      !isAddress(walletLink.wallet_address) ||
      getAddress(walletLink.wallet_address) !== getAddress(custodian)
    ) {
      return json(
        { error: 'Only this gemstone’s verified custodian may view delivery details' },
        403,
      );
    }

    await audit(
      membership.profileId,
      'redemption.fulfillment_viewed',
      'redemption_request',
      record.id as string,
      { tokenId },
    );

    return json({
      tokenId: record.token_id,
      gemId: record.gem_id,
      method: record.fulfillment_method,
      details: record.fulfillment_details,
      status: record.status,
      requestHash: record.request_hash,
      requestedAt: record.created_at,
    });
  } catch (error) {
    if (error instanceof NotACustodianError) return json({ error: error.message }, 403);
    return json({ error: safeErrorMessage(error, 'Could not read the redemption request') }, 400);
  }
});

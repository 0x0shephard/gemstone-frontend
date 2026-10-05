import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { createCommitment } from '../_shared/commitment.ts';
import { json, preflight } from '../_shared/cors.ts';
import { requireProtocolDeployment } from '../_shared/deployment.ts';
import { keccak256, toBytes } from 'npm:viem@2';
import {
  normalizedFulfillmentDetails,
  sameFulfillmentDetails,
} from '../_shared/redemptionCommitment.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const user = await requireUser(request);
    const { wallet, gemId, tokenId, fulfillmentMethod, fulfillmentDetails, clientRequestId } =
      await request.json();
    if (!UUID.test(String(clientRequestId ?? ''))) {
      return json({ error: 'clientRequestId must be a UUID' }, 400);
    }
    if (!['pickup', 'insured_delivery'].includes(fulfillmentMethod)) {
      return json({ error: 'Invalid fulfillment method' }, 400);
    }
    const normalizedDetails = normalizedFulfillmentDetails(fulfillmentMethod, fulfillmentDetails);

    const admin = adminClient();
    const deployment = await requireProtocolDeployment(admin, request);
    const normalizedWallet = String(wallet).toLowerCase();
    const { data: link } = await admin
      .from('wallet_links')
      .select('id')
      .eq('profile_id', user.id)
      .eq('wallet_address', normalizedWallet)
      .eq('is_primary', true)
      .not('verified_at', 'is', null)
      .maybeSingle();
    if (!link) return json({ error: 'Verified primary wallet required' }, 403);

    const { data: existing, error: existingError } = await admin
      .from('redemption_requests')
      .select(
        'id,request_hash,canonical_payload,status,requester_wallet,gem_id::text,token_id::text,fulfillment_method,fulfillment_details',
      )
      .eq('deployment_id', deployment.id)
      .eq('requester_id', user.id)
      .eq('client_request_id', clientRequestId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      if (
        existing.requester_wallet !== normalizedWallet ||
        String(existing.gem_id) !== String(gemId) ||
        String(existing.token_id) !== String(tokenId) ||
        existing.fulfillment_method !== fulfillmentMethod ||
        !sameFulfillmentDetails(existing.fulfillment_details, normalizedDetails)
      ) {
        return json(
          { error: 'clientRequestId is already bound to different redemption input' },
          409,
        );
      }
      if (!existing.request_hash || !existing.canonical_payload || existing.status === 'draft') {
        throw new Error('The prior redemption commitment is incomplete; contact support');
      }
      return json({
        workflowId: existing.id,
        workflowIdHash: keccak256(toBytes(existing.id)),
        requestHash: existing.request_hash,
        canonicalPayload: existing.canonical_payload,
        resumed: true,
      });
    }

    const { data: record, error } = await admin
      .from('redemption_requests')
      .insert({
        deployment_id: deployment.id,
        client_request_id: clientRequestId,
        requester_id: user.id,
        requester_wallet: normalizedWallet,
        gem_id: String(gemId),
        token_id: String(tokenId),
        fulfillment_method: fulfillmentMethod,
        fulfillment_details: normalizedDetails,
      })
      .select('id')
      .single();
    if (error) throw error;
    const timestamp = new Date().toISOString();
    const commitment = createCommitment({
      requesterWallet: normalizedWallet,
      gemId: String(gemId),
      tokenId: String(tokenId),
      fulfillmentMethod,
      fulfillmentDetails: normalizedDetails,
      workflowRecordId: record.id,
      timestamp,
    });
    const { data: committed, error: commitmentError } = await admin
      .from('redemption_requests')
      .update({
        status: 'committed',
        request_hash: commitment.hash,
        canonical_payload: commitment.canonicalPayload,
        commitment_nonce: commitment.nonce,
      })
      .eq('deployment_id', deployment.id)
      .eq('id', record.id)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle();
    if (commitmentError) throw commitmentError;
    if (!committed) {
      throw new Error('The redemption workflow could not be persisted; no chain request was made');
    }
    await audit(user.id, 'redemption.commitment_created', 'redemption_request', record.id, {
      hash: commitment.hash,
    });
    return json({
      workflowId: record.id,
      workflowIdHash: keccak256(toBytes(record.id)),
      requestHash: commitment.hash,
      canonicalPayload: commitment.canonicalPayload,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Commitment failed' }, 400);
  }
});

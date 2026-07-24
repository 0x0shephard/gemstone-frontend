import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { createCommitment } from '../_shared/commitment.ts';
import { json, preflight } from '../_shared/cors.ts';

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const user = await requireUser(request);
    const { wallet, gemId, tokenId, fulfillmentMethod, fulfillmentDetails } = await request.json();
    if (!['pickup', 'insured_delivery'].includes(fulfillmentMethod)) {
      return json({ error: 'Invalid fulfillment method' }, 400);
    }
    if (fulfillmentMethod === 'pickup' && !fulfillmentDetails?.pickupLocation) {
      return json({ error: 'Pickup location is required' }, 400);
    }
    if (
      fulfillmentMethod === 'insured_delivery' &&
      (!fulfillmentDetails?.recipientName ||
        !fulfillmentDetails?.addressLine1 ||
        !fulfillmentDetails?.city ||
        !fulfillmentDetails?.country ||
        !fulfillmentDetails?.postalCode)
    )
      return json({ error: 'Complete insured-delivery details are required' }, 400);

    const admin = adminClient();
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

    const { data: record, error } = await admin
      .from('redemption_requests')
      .insert({
        requester_id: user.id,
        requester_wallet: normalizedWallet,
        gem_id: String(gemId),
        token_id: String(tokenId),
        fulfillment_method: fulfillmentMethod,
        fulfillment_details: fulfillmentDetails,
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
      workflowRecordId: record.id,
      timestamp,
    });
    await admin
      .from('redemption_requests')
      .update({
        status: 'committed',
        request_hash: commitment.hash,
        canonical_payload: commitment.canonicalPayload,
        commitment_nonce: commitment.nonce,
      })
      .eq('id', record.id);
    await audit(user.id, 'redemption.commitment_created', 'redemption_request', record.id, {
      hash: commitment.hash,
    });
    return json({
      workflowId: record.id,
      requestHash: commitment.hash,
      canonicalPayload: commitment.canonicalPayload,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Commitment failed' }, 400);
  }
});

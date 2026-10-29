import { adminClient, requireUser } from '../_shared/auth.ts';
import { json, preflight } from '../_shared/cors.ts';
import { requireProtocolDeployment } from '../_shared/deployment.ts';

/**
 * Read-only view of a submission's evidence commitment.
 *
 * This endpoint used to *create* the commitment, from the `sha256` values the
 * seller wrote on their own evidence rows and from the unpinned inline metadata
 * URI. Activation then found a commitment already present and skipped both the
 * storage-verified certificate hashing and the IPFS publication — so a seller
 * could fix on-chain whatever digests and metadata they liked.
 *
 * The commitment is now built only by `prepareSellerSubmission`, during the
 * administrator-started activation. Until then there is nothing to return.
 */
Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const user = await requireUser(request);
    const { submissionId } = await request.json();
    const admin = adminClient();
    const deployment = await requireProtocolDeployment(admin, request);
    const { data: submission, error } = await admin
      .from('seller_submissions')
      .select('id,status,certificate_hash,canonical_payload')
      .eq('id', submissionId)
      .eq('deployment_id', deployment.id)
      .eq('seller_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!submission) return json({ error: 'Submission not found' }, 404);
    if (!submission.certificate_hash || !submission.canonical_payload) {
      return json(
        {
          error:
            'The evidence commitment is created by Digital Carat during protocol activation, from the stored certificates and the published metadata',
        },
        409,
      );
    }
    return json({
      certificateHash: submission.certificate_hash,
      canonicalPayload: submission.canonical_payload,
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Commitment lookup failed' },
      400,
    );
  }
});

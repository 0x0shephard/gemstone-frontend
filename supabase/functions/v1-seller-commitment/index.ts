import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { createCommitment } from '../_shared/commitment.ts';
import { json, preflight } from '../_shared/cors.ts';

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const user = await requireUser(request);
    const { submissionId } = await request.json();
    const admin = adminClient();
    const { data: submission, error } = await admin
      .from('seller_submissions')
      .select(
        'id,seller_id,seller_wallet,attributes,sale_mode,metadata_uri,status,approved_at,certificate_hash,canonical_payload',
      )
      .eq('id', submissionId)
      .eq('seller_id', user.id)
      .single();
    if (error || !submission || submission.status !== 'approved') {
      return json({ error: 'Only approved submissions can be committed' }, 409);
    }
    if (submission.certificate_hash && submission.canonical_payload) {
      return json({
        certificateHash: submission.certificate_hash,
        canonicalPayload: submission.canonical_payload,
      });
    }
    const { data: files } = await admin
      .from('evidence_files')
      .select('category,sha256')
      .eq('submission_id', submissionId)
      .order('sha256');
    const certificates = (files ?? [])
      .filter((file) => file.category === 'certificate')
      .map((file) => file.sha256);
    if (certificates.length === 0 || !submission.metadata_uri) {
      return json({ error: 'Approved certificates and metadata URI are required' }, 409);
    }
    const committedAt = new Date().toISOString();
    const commitment = createCommitment({
      submissionId,
      sellerWallet: submission.seller_wallet,
      approvedAttributes: submission.attributes,
      saleMode: submission.sale_mode,
      certificateDigests: certificates,
      metadataUri: submission.metadata_uri,
      timestamp: committedAt,
    });
    const { data: saved, error: updateError } = await admin
      .from('seller_submissions')
      .update({
        certificate_hash: commitment.hash,
        canonical_payload: commitment.canonicalPayload,
        commitment_nonce: commitment.nonce,
      })
      .eq('id', submissionId)
      .is('certificate_hash', null)
      .select('certificate_hash,canonical_payload')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!saved) {
      const { data: existing, error: existingError } = await admin
        .from('seller_submissions')
        .select('certificate_hash,canonical_payload')
        .eq('id', submissionId)
        .single();
      if (existingError || !existing?.certificate_hash || !existing.canonical_payload) {
        throw existingError ?? new Error('Commitment persistence failed');
      }
      return json({
        certificateHash: existing.certificate_hash,
        canonicalPayload: existing.canonical_payload,
      });
    }
    await audit(user.id, 'seller.commitment_created', 'seller_submission', submissionId, {
      hash: commitment.hash,
    });
    return json({
      certificateHash: saved.certificate_hash,
      canonicalPayload: saved.canonical_payload,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Commitment failed' }, 400);
  }
});

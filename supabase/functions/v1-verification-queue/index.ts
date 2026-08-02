import { adminClient, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { matrixOptions } from '../_shared/valuationMatrix.ts';
import { verificationMode } from '../_shared/settings.ts';
import { NotAVerifierError, QUEUE_COLUMNS, requireVerifier } from '../_shared/verifier.ts';

/**
 * Submissions awaiting grading, plus the evidence for one of them.
 *
 * Seller identity is stripped by the column selection, not by the UI. A grader
 * assesses the stone; knowing whose stone it is serves no grading purpose and
 * creates a conflict of interest.
 */

/**
 * The one status a lab acts on.
 *
 * This previously read `['approved', 'custody_confirmed']` and matched nothing:
 * `approved` survived only for the duration of the auto-activation request, and
 * `custody_confirmed` is an `activation_state`, never a `status`, so the filter
 * could not match a row that existed.
 */
const GRADABLE = ['awaiting_grading'];

/** Signed-URL lifetime. Long enough to assess a stone, short enough not to be shareable. */
const SIGNED_URL_TTL_SECONDS = 900;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const membership = await requireVerifier(admin, user.id);
    const { submissionId } = (await request.json().catch(() => ({}))) as {
      submissionId?: string;
    };

    if (submissionId) {
      const { data: submission, error } = await admin
        .from('seller_submissions')
        .select(QUEUE_COLUMNS)
        .eq('id', submissionId)
        .maybeSingle();
      if (error) throw error;
      if (!submission) return json({ error: 'Submission not found' }, 404);

      const { data: evidence, error: evidenceError } = await admin
        .from('evidence_files')
        .select('id,category,bucket,object_path,mime_type,sha256,created_at')
        .eq('submission_id', submissionId)
        .order('created_at');
      if (evidenceError) throw evidenceError;

      /*
       * Signed URLs are minted here rather than through `v1-private-file-url`,
       * which scopes to `owner_id` and would 404 for a lab. Granting verifiers a
       * separate, purpose-scoped path is safer than broadening the seller's.
       */
      const files = await Promise.all(
        (evidence ?? []).map(async (file) => {
          const { data: signed } = await admin.storage
            .from(file.bucket)
            .createSignedUrl(file.object_path, SIGNED_URL_TTL_SECONDS);
          return {
            id: file.id,
            category: file.category,
            mimeType: file.mime_type,
            sha256: file.sha256,
            createdAt: file.created_at,
            /*
             * Only gemstone media can become the public NFT image. Certificates
             * routinely name the seller and carry appraisal history, and pinning
             * is irreversible — so eligibility is decided here, not left to the
             * UI to remember.
             */
            eligibleAsPrimaryImage: file.category === 'gem_media',
            url: signed?.signedUrl ?? null,
          };
        }),
      );

      return json({
        organization: membership.organizationName,
        submission,
        evidence: files,
        matrix: matrixOptions(),
        expiresIn: SIGNED_URL_TTL_SECONDS,
      });
    }

    const { data, error } = await admin
      .from('seller_submissions')
      .select(QUEUE_COLUMNS)
      .in('status', GRADABLE)
      .is('graded_at', null)
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) throw error;

    return json({
      organization: membership.organizationName,
      role: membership.role,
      kind: membership.kind,
      // Only an admin organisation may change it; every member may see it, so a
      // grader can tell whether an empty queue means idle or means auto mode.
      verificationMode: await verificationMode(admin),
      canManageSettings: membership.kind === 'admin' && membership.role === 'org_admin',
      matrix: matrixOptions(),
      queue: data ?? [],
    });
  } catch (error) {
    if (error instanceof NotAVerifierError) return json({ error: 'Not found' }, 404);
    const message = safeErrorMessage(error, 'Verification queue unavailable');
    const authorizationError = message === 'Missing authorization' || message === 'Invalid session';
    return json({ error: message }, authorizationError ? 401 : 400);
  }
});

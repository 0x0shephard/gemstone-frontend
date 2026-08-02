import { adminClient, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { NotAVerifierError, QUEUE_COLUMNS, requireVerifier } from '../_shared/verifier.ts';

/**
 * Submissions awaiting grading, plus the evidence for one of them.
 *
 * Seller identity is stripped by the column selection, not by the UI. A grader
 * assesses the stone; knowing whose stone it is serves no grading purpose and
 * creates a conflict of interest.
 */

/** Statuses a lab is expected to act on. */
const GRADABLE = ['approved', 'custody_confirmed'];

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
            .createSignedUrl(file.object_path, 300);
          return {
            id: file.id,
            category: file.category,
            mimeType: file.mime_type,
            sha256: file.sha256,
            createdAt: file.created_at,
            url: signed?.signedUrl ?? null,
          };
        }),
      );

      return json({
        organization: membership.organizationName,
        submission,
        evidence: files,
        expiresIn: 300,
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
      queue: data ?? [],
    });
  } catch (error) {
    if (error instanceof NotAVerifierError) return json({ error: 'Not found' }, 404);
    const message = safeErrorMessage(error, 'Verification queue unavailable');
    const authorizationError = message === 'Missing authorization' || message === 'Invalid session';
    return json({ error: message }, authorizationError ? 401 : 400);
  }
});

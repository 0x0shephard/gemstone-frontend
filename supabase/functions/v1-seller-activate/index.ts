import { adminClient, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { activateSellerSubmission } from '../_shared/sellerAutomation.ts';
import { json, preflight } from '../_shared/cors.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const user = await requireUser(request);
    const { submissionId } = await request.json();
    if (typeof submissionId !== 'string' || !uuidPattern.test(submissionId)) {
      return json({ error: 'Submission ID must be a UUID' }, 400);
    }
    const admin = adminClient();
    const { data: submission, error: submissionError } = await admin
      .from('seller_submissions')
      .select('id,seller_wallet')
      .eq('id', submissionId)
      .eq('seller_id', user.id)
      .maybeSingle();
    if (submissionError) throw submissionError;
    if (!submission) return json({ error: 'Submission not found' }, 404);
    const { data: walletLink, error: walletError } = await admin
      .from('wallet_links')
      .select('id')
      .eq('profile_id', user.id)
      .eq('wallet_address', submission.seller_wallet)
      .eq('is_primary', true)
      .not('verified_at', 'is', null)
      .maybeSingle();
    if (walletError) throw walletError;
    if (!walletLink) return json({ error: 'A verified primary wallet is required' }, 403);
    return json(await activateSellerSubmission(admin, submissionId));
  } catch (error) {
    const message = safeErrorMessage(error, 'Seller activation failed');
    const authorizationError = message === 'Missing authorization' || message === 'Invalid session';
    return json({ error: message }, authorizationError ? 401 : 409);
  }
});

import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { activateSellerSubmission } from '../_shared/sellerAutomation.ts';
import { json, preflight } from '../_shared/cors.ts';
import { canonicalDocument } from '../_shared/ipfs.ts';
import { dataUri } from '../_shared/metadataDocument.ts';

const walletPattern = /^0x[0-9a-f]{40}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const attributeFields = [
  'name',
  'gemstoneType',
  'origin',
  'dimensions',
  'color',
  'clarity',
  'cut',
  'treatment',
  'gradingLab',
  'certificateNumber',
] as const;

type AttributeField = (typeof attributeFields)[number];
type SellerAttributes = Record<AttributeField, string> & { caratWeight: number };

interface SellerSubmitBody {
  action?: unknown;
  submissionId?: unknown;
  clientSubmissionId?: unknown;
  sellerWallet?: unknown;
  attributes?: unknown;
  saleMode?: unknown;
  custodyPreference?: unknown;
  notes?: unknown;
}

function requiredText(value: unknown, label: string, maximumLength = 200): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new Error(`${label} exceeds ${maximumLength} characters`);
  }
  return normalized;
}

function parseAttributes(value: unknown): SellerAttributes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Gemstone attributes are required');
  }
  const record = value as Record<string, unknown>;
  const parsed = Object.fromEntries(
    attributeFields.map((field) => [field, requiredText(record[field], field)]),
  ) as Record<AttributeField, string>;
  const caratWeight = Number(record.caratWeight);
  if (!Number.isFinite(caratWeight) || caratWeight <= 0 || caratWeight > 100_000) {
    throw new Error('Carat weight must be a positive number');
  }
  return { ...parsed, caratWeight };
}

/**
 * Provisional inline metadata recorded at submission time.
 *
 * This is not the document that reaches the chain. `prepareSellerSubmission`
 * republishes it to IPFS and swaps in the resulting `ipfs://` CID immediately
 * before the evidence commitment binds the URI, which is the last point at
 * which it can still change. Publishing here would be premature: a submission
 * may never be approved, and a rejected one should leave nothing pinned.
 *
 * No `image` yet — seller media lands in private Supabase buckets and there is
 * no public media pipeline to reference.
 *
 * Never add seller identity, vault location, or appraisal notes here; the
 * shared builder rejects them.
 */
function publicMetadata(attributes: SellerAttributes): string {
  return dataUri(canonicalDocument(attributes));
}

function responseFor(submission: {
  id: string;
  status: string;
  metadata_uri: string | null;
  verification_provider: string | null;
}) {
  return {
    submissionId: submission.id,
    status: submission.status,
    metadataUri: submission.metadata_uri,
    verificationProvider: submission.verification_provider,
  };
}

async function requireLinkedWallet(
  admin: ReturnType<typeof adminClient>,
  profileId: string,
  sellerWallet: string,
) {
  const { data, error } = await admin
    .from('wallet_links')
    .select('id')
    .eq('profile_id', profileId)
    .eq('wallet_address', sellerWallet)
    .eq('is_primary', true)
    .not('verified_at', 'is', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('A verified primary wallet is required');
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const body = (await request.json()) as SellerSubmitBody;
    const sellerWallet = requiredText(body.sellerWallet, 'Seller wallet', 42).toLowerCase();
    if (!walletPattern.test(sellerWallet)) {
      return json({ error: 'Seller wallet is invalid' }, 400);
    }
    const admin = adminClient();
    try {
      await requireLinkedWallet(admin, user.id, sellerWallet);
    } catch (error) {
      if (error instanceof Error && error.message === 'A verified primary wallet is required') {
        return json({ error: error.message }, 403);
      }
      throw error;
    }

    if (body.action === 'verify') {
      const submissionId = requiredText(body.submissionId, 'Submission ID', 36);
      if (!uuidPattern.test(submissionId)) {
        return json({ error: 'Submission ID must be a UUID' }, 400);
      }
      const { data: submission, error: submissionError } = await admin
        .from('seller_submissions')
        .select(
          'id,status,seller_wallet,sale_mode,custody_preference,metadata_uri,verification_provider',
        )
        .eq('id', submissionId)
        .eq('seller_id', user.id)
        .maybeSingle();
      if (submissionError) throw submissionError;
      if (!submission) return json({ error: 'Submission not found' }, 404);
      if (submission.seller_wallet !== sellerWallet) {
        return json({ error: 'Submission wallet mismatch' }, 403);
      }
      if (submission.status === 'approved' || submission.status === 'registered') {
        try {
          return json(await activateSellerSubmission(admin, submissionId));
        } catch (error) {
          return json(
            {
              ...responseFor(submission),
              activationState: 'failed',
              activationError: safeErrorMessage(error, 'Automatic activation failed'),
            },
            202,
          );
        }
      }
      if (submission.status !== 'submitted') {
        return json({ error: 'Submission cannot be auto-verified in its current state' }, 409);
      }

      const { data: files, error: filesError } = await admin
        .from('evidence_files')
        .select('category')
        .eq('submission_id', submissionId)
        .eq('owner_id', user.id);
      if (filesError) throw filesError;
      const certificateCount = (files ?? []).filter(
        (file) => file.category === 'certificate',
      ).length;
      const mediaCount = (files ?? []).filter((file) => file.category === 'gem_media').length;
      if (certificateCount < 1 || mediaCount < 1) {
        return json({ error: 'At least one certificate and one gemstone image are required' }, 409);
      }
      if (mediaCount > 10) {
        return json({ error: 'A maximum of 10 gemstone media files is allowed' }, 409);
      }

      const { data: approved, error: approvalError } = await admin
        .from('seller_submissions')
        .update({
          status: 'approved',
          verification_provider: 'mvp-auto',
          approved_at: new Date().toISOString(),
        })
        .eq('id', submissionId)
        .eq('seller_id', user.id)
        .eq('status', 'submitted')
        .select('id,status,metadata_uri,verification_provider')
        .maybeSingle();
      if (approvalError) throw approvalError;
      if (!approved) {
        return json({ error: 'Submission changed while it was being verified' }, 409);
      }
      await audit(user.id, 'seller.submission_auto_approved', 'seller_submission', approved.id, {
        verificationProvider: 'mvp-auto',
        certificateCount,
        mediaCount,
        saleMode: submission.sale_mode,
        custodyPreference: submission.custody_preference,
      });
      try {
        return json(await activateSellerSubmission(admin, approved.id));
      } catch (error) {
        return json(
          {
            ...responseFor(approved),
            activationState: 'failed',
            activationError: safeErrorMessage(error, 'Automatic activation failed'),
          },
          202,
        );
      }
    }

    if (body.action !== undefined && body.action !== 'create') {
      return json({ error: 'Action must be create or verify' }, 400);
    }
    const clientSubmissionId = requiredText(body.clientSubmissionId, 'Client submission ID', 36);
    if (!uuidPattern.test(clientSubmissionId)) {
      return json({ error: 'Client submission ID must be a UUID' }, 400);
    }
    const attributes = parseAttributes(body.attributes);
    if (!['buy_now', 'auction'].includes(String(body.saleMode))) {
      return json({ error: 'Sale mode must be buy_now or auction' }, 400);
    }
    if (
      !['protocol_custodian', 'approved_existing_custodian'].includes(
        String(body.custodyPreference),
      )
    ) {
      return json({ error: 'Custody preference is invalid' }, 400);
    }
    const notes =
      body.notes === undefined || body.notes === null || body.notes === ''
        ? null
        : requiredText(body.notes, 'Notes', 4_000);

    const { data: existing, error: existingError } = await admin
      .from('seller_submissions')
      .select('id,status,metadata_uri,verification_provider')
      .eq('client_submission_id', clientSubmissionId)
      .eq('seller_id', user.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return json(responseFor(existing));

    const { data: submission, error: insertError } = await admin
      .from('seller_submissions')
      .insert({
        client_submission_id: clientSubmissionId,
        seller_id: user.id,
        seller_wallet: sellerWallet,
        gem_name: attributes.name,
        carats: attributes.caratWeight,
        attributes,
        sale_mode: body.saleMode,
        custody_preference: body.custodyPreference,
        notes,
        status: 'submitted',
        verification_provider: 'mvp-auto-pending',
        metadata_uri: publicMetadata(attributes),
      })
      .select('id,status,metadata_uri,verification_provider')
      .single();
    if (insertError) {
      if (insertError.code === '23505') {
        const { data: concurrent } = await admin
          .from('seller_submissions')
          .select('id,status,metadata_uri,verification_provider')
          .eq('client_submission_id', clientSubmissionId)
          .eq('seller_id', user.id)
          .maybeSingle();
        if (concurrent) return json(responseFor(concurrent));
      }
      throw insertError;
    }

    return json(responseFor(submission), 201);
  } catch (error) {
    const message = safeErrorMessage(error, 'Seller submission failed');
    const authorizationError = message === 'Missing authorization' || message === 'Invalid session';
    return json({ error: message }, authorizationError ? 401 : 400);
  }
});

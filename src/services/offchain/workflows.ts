import type { Hash } from 'viem';
import { invokeEdgeFunction, requireClient } from './invoke';

export type KycStatus = 'not_started' | 'pending' | 'approved' | 'rejected' | 'on_hold';

export interface SellerAttributes {
  name: string;
  gemstoneType: string;
  origin: string;
  caratWeight: number;
  dimensions: string;
  color: string;
  clarity: string;
  cut: string;
  treatment: string;
  gradingLab: string;
  certificateNumber: string;
}

export interface SellerSubmissionInput {
  sellerWallet: string;
  attributes: SellerAttributes;
  saleMode: 'buy_now' | 'auction';
  custodyPreference: 'protocol_custodian' | 'approved_existing_custodian';
  notes: string;
  certificates: File[];
  media: File[];
}

const limits = {
  certificate: {
    bytes: 20 * 1024 * 1024,
    mime: new Set(['application/pdf', 'image/jpeg', 'image/png']),
  },
  gem_media: {
    bytes: 10 * 1024 * 1024,
    mime: new Set(['image/jpeg', 'image/png', 'image/webp']),
  },
} as const;

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateFile(file: File, category: keyof typeof limits) {
  const limit = limits[category];
  if (!limit.mime.has(file.type as never))
    throw new Error(`${file.name} has an unsupported file type`);
  if (file.size > limit.bytes) throw new Error(`${file.name} exceeds the upload size limit`);
}

function safeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(-100);
}

async function uploadEvidence(
  userId: string,
  submissionId: string,
  category: 'certificate' | 'gem_media',
  files: File[],
  uploadedObjects: Array<{ bucket: string; objectPath: string }>,
) {
  const client = requireClient();
  const bucket = category === 'certificate' ? 'certificates' : 'gem-media';
  for (const file of files) {
    validateFile(file, category);
    const objectPath = `${userId}/${submissionId}/${crypto.randomUUID()}-${safeName(file.name)}`;
    const { error: uploadError } = await client.storage.from(bucket).upload(objectPath, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw uploadError;
    uploadedObjects.push({ bucket, objectPath });
    const { error: recordError } = await client.from('evidence_files').insert({
      owner_id: userId,
      submission_id: submissionId,
      category,
      bucket,
      object_path: objectPath,
      mime_type: file.type,
      byte_size: file.size,
      sha256: await sha256(file),
    });
    if (recordError) throw recordError;
  }
}

export async function getKycStatus(): Promise<KycStatus> {
  const client = requireClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return 'not_started';
  const { data } = await client
    .from('kyc_status')
    .select('status')
    .eq('user_id', user.id)
    .maybeSingle();
  const status = data?.status;
  if (!status || status === 'none') return 'not_started';
  return status as KycStatus;
}

export async function issueSumsubToken(): Promise<{ token: string; expiresIn: number }> {
  return invokeEdgeFunction<{ token: string; expiresIn: number }>('v1-sumsub-token');
}

export interface SellerSubmissionResult {
  submissionId: string;
  /**
   * `awaiting_grading` under lab verification, `approved`/`registered` under the
   * automatic path. All three are successes; they differ only in what happens next.
   */
  status: string;
}

export async function submitSellerGem(
  input: SellerSubmissionInput,
): Promise<SellerSubmissionResult> {
  if (input.certificates.length === 0) throw new Error('At least one certificate is required');
  if (input.media.length === 0) throw new Error('At least one gemstone image is required');
  if (input.media.length > 10) throw new Error('A maximum of 10 gemstone media files is allowed');
  input.certificates.forEach((file) => validateFile(file, 'certificate'));
  input.media.forEach((file) => validateFile(file, 'gem_media'));

  const client = requireClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error('Sign in before submitting a gemstone');

  const clientSubmissionId = crypto.randomUUID();
  const submission = await invokeEdgeFunction<{ submissionId?: string }>('v1-seller-submit', {
    action: 'create',
    clientSubmissionId,
    sellerWallet: input.sellerWallet,
    attributes: input.attributes,
    saleMode: input.saleMode,
    custodyPreference: input.custodyPreference,
    notes: input.notes,
  });
  if (!submission?.submissionId) throw new Error('The seller submission was not created');

  const submissionId = String(submission.submissionId);
  const uploadedObjects: Array<{ bucket: string; objectPath: string }> = [];
  let verificationStarted = false;
  try {
    await uploadEvidence(user.id, submissionId, 'certificate', input.certificates, uploadedObjects);
    await uploadEvidence(user.id, submissionId, 'gem_media', input.media, uploadedObjects);
    verificationStarted = true;
    const verification = await invokeEdgeFunction<{ status?: string }>('v1-seller-submit', {
      action: 'verify',
      submissionId,
      sellerWallet: input.sellerWallet,
    });
    /*
     * No allow-list of statuses here, deliberately. `invokeEdgeFunction` already
     * throws on any non-2xx and on an inline `error`, so reaching this line means
     * the server accepted the submission — whatever stage it routed it to.
     *
     * Enumerating the successful statuses instead broke twice in a row: once when
     * the lab path introduced `awaiting_grading`, and again when custody intake
     * introduced `awaiting_custody`. Each time a correctly queued stone was
     * reported to the seller as rejected evidence. The client has no business
     * knowing the server's workflow stages.
     */
    const status = String(verification?.status ?? 'submitted');
    return { submissionId, status };
  } catch (uploadError) {
    if (!verificationStarted) {
      await Promise.all(
        uploadedObjects.map(({ bucket, objectPath }) =>
          client.storage.from(bucket).remove([objectPath]),
        ),
      );
      await client.from('seller_submissions').delete().eq('id', submissionId);
    }
    throw uploadError;
  }
}

export interface SellerSubmissionSummary {
  id: string;
  status:
    | 'submitted'
    | 'in_review'
    /** Evidence accepted; waiting for the stone to physically arrive. */
    | 'awaiting_custody'
    /** In the vault and logged. Queued for a grading lab, nothing on-chain yet. */
    | 'awaiting_grading'
    | 'graded'
    | 'expert_review'
    | 'changes_requested'
    | 'approved'
    | 'rejected'
    | 'registered';
  saleMode: 'buy_now' | 'auction';
  verificationProvider?: string;
  metadataUri?: string;
  certificateHash?: Hash;
  onchainGemId?: string;
  activationState?: string;
  activationError?: string;
  valuationMethod?: string;
  approvedValuationUsd?: string;
  /** Set by a grading lab when it refuses the stone. Visible to the seller. */
  rejectionReason?: string;
  createdAt: string;
}

export async function getSellerSubmissions(): Promise<SellerSubmissionSummary[]> {
  const { data, error } = await requireClient()
    .from('seller_submissions')
    .select(
      /*
       * The two `numeric(78,0)` columns are cast to text at the query.
       * PostgREST emits numerics unquoted, so supabase-js parses them into JS
       * numbers: an 18-decimal USD figure of $1,000 or more exceeds 1e21, whose
       * `toString()` is exponential ("3.672e+21"), which `BigInt()` rejects — and
       * the value has already lost precision as a double by then. Casting keeps
       * the exact integer and keeps it parseable.
       */
      'id,status,sale_mode,verification_provider,metadata_uri,certificate_hash,onchain_gem_id::text,activation_state,activation_error,valuation_method,approved_valuation_usd::text,rejection_reason,created_at',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((submission) => ({
    id: submission.id,
    status: submission.status,
    saleMode: submission.sale_mode,
    verificationProvider: submission.verification_provider ?? undefined,
    metadataUri: submission.metadata_uri ?? undefined,
    certificateHash: (submission.certificate_hash as Hash | null) ?? undefined,
    onchainGemId:
      submission.onchain_gem_id === null ? undefined : String(submission.onchain_gem_id),
    activationState: submission.activation_state ?? undefined,
    activationError: submission.activation_error ?? undefined,
    valuationMethod: submission.valuation_method ?? undefined,
    approvedValuationUsd:
      submission.approved_valuation_usd === null
        ? undefined
        : String(submission.approved_valuation_usd),
    rejectionReason: submission.rejection_reason ?? undefined,
    createdAt: submission.created_at,
  }));
}

export async function activateSellerGem(submissionId: string): Promise<void> {
  await invokeEdgeFunction('v1-seller-activate', { submissionId });
}

export async function createSellerCommitment(
  submissionId: string,
): Promise<{ certificateHash: Hash; canonicalPayload: string }> {
  return invokeEdgeFunction<{ certificateHash: Hash; canonicalPayload: string }>(
    'v1-seller-commitment',
    { submissionId },
  );
}

export interface RedemptionCommitmentInput {
  wallet: string;
  gemId: bigint;
  tokenId: bigint;
  fulfillmentMethod: 'pickup' | 'insured_delivery';
  fulfillmentDetails: Record<string, string>;
}

export async function createRedemptionCommitment(
  input: RedemptionCommitmentInput,
): Promise<{ workflowId: string; requestHash: Hash }> {
  return invokeEdgeFunction<{ workflowId: string; requestHash: Hash }>('v1-redemption-commitment', {
    ...input,
    gemId: input.gemId.toString(),
    tokenId: input.tokenId.toString(),
  });
}

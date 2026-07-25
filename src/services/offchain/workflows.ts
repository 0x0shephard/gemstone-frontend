import type { Hash } from 'viem';
import { supabase } from '@/providers/supabase';

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

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

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
  const { data, error } = await requireClient().functions.invoke('v1-sumsub-token');
  if (error || !data?.token)
    throw new Error(error?.message ?? data?.error ?? 'KYC token request failed');
  return data;
}

export async function submitSellerGem(input: SellerSubmissionInput): Promise<string> {
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
  const { data: submission, error } = await client.functions.invoke('v1-seller-submit', {
    body: {
      action: 'create',
      clientSubmissionId,
      sellerWallet: input.sellerWallet,
      attributes: input.attributes,
      saleMode: input.saleMode,
      custodyPreference: input.custodyPreference,
      notes: input.notes,
    },
  });
  if (error || submission?.error || !submission?.submissionId) {
    throw new Error(
      submission?.error ?? error?.message ?? 'The seller submission could not be verified',
    );
  }

  const submissionId = String(submission.submissionId);
  const uploadedObjects: Array<{ bucket: string; objectPath: string }> = [];
  let verificationStarted = false;
  try {
    await uploadEvidence(user.id, submissionId, 'certificate', input.certificates, uploadedObjects);
    await uploadEvidence(user.id, submissionId, 'gem_media', input.media, uploadedObjects);
    verificationStarted = true;
    const { data: verification, error: verificationError } = await client.functions.invoke(
      'v1-seller-submit',
      {
        body: {
          action: 'verify',
          submissionId,
          sellerWallet: input.sellerWallet,
        },
      },
    );
    if (
      verificationError ||
      verification?.error ||
      !['approved', 'registered'].includes(String(verification?.status))
    ) {
      throw new Error(
        verification?.error ??
          verificationError?.message ??
          'The uploaded evidence could not be auto-verified',
      );
    }
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
  return submissionId;
}

export interface SellerSubmissionSummary {
  id: string;
  status:
    | 'submitted'
    | 'in_review'
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
  createdAt: string;
}

export async function getSellerSubmissions(): Promise<SellerSubmissionSummary[]> {
  const { data, error } = await requireClient()
    .from('seller_submissions')
    .select(
      'id,status,sale_mode,verification_provider,metadata_uri,certificate_hash,onchain_gem_id,activation_state,activation_error,valuation_method,approved_valuation_usd,created_at',
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
    createdAt: submission.created_at,
  }));
}

export async function activateSellerGem(submissionId: string): Promise<void> {
  const { data, error } = await requireClient().functions.invoke('v1-seller-activate', {
    body: { submissionId },
  });
  if (error || data?.error) {
    throw new Error(data?.error ?? error?.message ?? 'Seller activation failed');
  }
}

export async function createSellerCommitment(
  submissionId: string,
): Promise<{ certificateHash: Hash; canonicalPayload: string }> {
  const { data, error } = await requireClient().functions.invoke('v1-seller-commitment', {
    body: { submissionId },
  });
  if (error || !data?.certificateHash) {
    throw new Error(error?.message ?? data?.error ?? 'Seller commitment failed');
  }
  return data;
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
  const { data, error } = await requireClient().functions.invoke('v1-redemption-commitment', {
    body: {
      ...input,
      gemId: input.gemId.toString(),
      tokenId: input.tokenId.toString(),
    },
  });
  if (error || !data?.requestHash) {
    throw new Error(error?.message ?? data?.error ?? 'Redemption commitment failed');
  }
  return data;
}

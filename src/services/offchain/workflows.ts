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
    .from('kyc_profiles')
    .select('status')
    .eq('profile_id', user.id)
    .maybeSingle();
  return (data?.status as KycStatus | undefined) ?? 'not_started';
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

  const { data: submission, error } = await client
    .from('seller_submissions')
    .insert({
      seller_id: user.id,
      seller_wallet: input.sellerWallet.toLowerCase(),
      attributes: input.attributes,
      sale_mode: input.saleMode,
      custody_preference: input.custodyPreference,
      notes: input.notes,
    })
    .select('id')
    .single();
  if (error) throw error;

  try {
    await uploadEvidence(user.id, submission.id, 'certificate', input.certificates);
    await uploadEvidence(user.id, submission.id, 'gem_media', input.media);
  } catch (uploadError) {
    await client.from('seller_submissions').delete().eq('id', submission.id);
    throw uploadError;
  }
  return submission.id;
}

export interface SellerSubmissionSummary {
  id: string;
  status:
    'submitted' | 'expert_review' | 'changes_requested' | 'approved' | 'rejected' | 'registered';
  saleMode: 'buy_now' | 'auction';
  metadataUri?: string;
  certificateHash?: Hash;
  onchainGemId?: string;
  createdAt: string;
}

export async function getSellerSubmissions(): Promise<SellerSubmissionSummary[]> {
  const { data, error } = await requireClient()
    .from('seller_submissions')
    .select('id,status,sale_mode,metadata_uri,certificate_hash,onchain_gem_id,created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((submission) => ({
    id: submission.id,
    status: submission.status,
    saleMode: submission.sale_mode,
    metadataUri: submission.metadata_uri ?? undefined,
    certificateHash: (submission.certificate_hash as Hash | null) ?? undefined,
    onchainGemId:
      submission.onchain_gem_id === null ? undefined : String(submission.onchain_gem_id),
    createdAt: submission.created_at,
  }));
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

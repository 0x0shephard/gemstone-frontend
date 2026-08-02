import { supabase } from '@/providers/supabase';

/**
 * Verification portal client.
 *
 * Every call is service-role mediated by an Edge Function. Seller identity never
 * reaches this layer: the queue endpoint strips it at the query, so there is no
 * field here to accidentally render.
 */

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

async function invoke<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await requireClient().functions.invoke(name, { body });
  if (error || data?.error) {
    throw new Error(data?.error ?? error?.message ?? 'Verification request failed');
  }
  return data as T;
}

export interface QueueItem {
  id: string;
  gem_name: string;
  carats: number | null;
  attributes: Record<string, unknown> | null;
  graded_attributes: Record<string, unknown> | null;
  status: string;
  created_at: string;
}

export interface EvidenceFile {
  id: string;
  category: string;
  mimeType: string;
  sha256: string;
  createdAt: string;
  /** Short-lived signed URL, minted per request. Null if signing failed. */
  url: string | null;
}

export interface GradeInput {
  variety: string;
  caratWeight: number;
  clarity: string;
  treatment: string;
  shape: string;
  color: string;
  colorGrade: string;
}

export interface MultiplierDetail {
  criterion: 'shape' | 'color' | 'colorGrade';
  choice: string;
  choiceCount: number;
  observed: number;
  totalObserved: number;
  sharePpm: string;
  rawPpm: string;
  multiplierPpm: string;
  clamped: boolean;
}

export interface Breakdown {
  basePricePerCaratUsd: string;
  caratMultiplierPpm: string;
  clarityMultiplierPpm: string;
  treatmentMultiplierPpm: string;
  baseValueUsd: string;
  marketMultiplierPpm: string;
  marketMultipliers: MultiplierDetail[];
  priceClamped: boolean;
}

export interface PricePreview {
  matrixVersion: string;
  approvedValuationUsd: string;
  breakdown: Breakdown;
}

/** Returns null when the signed-in user is not an active verifier. */
export async function loadQueue(): Promise<{
  organization: string;
  role: string;
  queue: QueueItem[];
} | null> {
  try {
    return await invoke('v1-verification-queue');
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return null;
    throw error;
  }
}

export async function loadSubmission(
  submissionId: string,
): Promise<{ submission: QueueItem; evidence: EvidenceFile[] }> {
  return invoke('v1-verification-queue', { submissionId });
}

/**
 * Prices without committing. Computed by the same server code path that will
 * write the value, so the figure a grader approves is the figure recorded.
 */
export async function previewPrice(
  submissionId: string,
  graded: GradeInput,
): Promise<PricePreview> {
  return invoke('v1-verification-grade', { submissionId, graded, preview: true });
}

/** Commits the grading and fires the on-chain transactions. */
export async function submitGrading(
  submissionId: string,
  graded: GradeInput,
): Promise<PricePreview & { activation: { onchainGemId?: string; transactionHash?: string } }> {
  return invoke('v1-verification-grade', { submissionId, graded });
}

export const ppmToNumber = (ppm: string): number => Number(ppm) / 1_000_000;
export const usdFromBaseUnits = (value: string): number => Number(BigInt(value) / 10n ** 18n);

import { usdFromBaseUnits as usdFromBase } from '@/lib/format';
import { invokeEdgeFunction } from './invoke';

/**
 * Verification portal client.
 *
 * Every call is service-role mediated by an Edge Function. Seller identity never
 * reaches this layer: the queue endpoint strips it at the query, so there is no
 * field here to accidentally render.
 */

const invoke = invokeEdgeFunction;

export interface QueueItem {
  id: string;
  gem_name: string;
  carats: number | null;
  attributes: Record<string, unknown> | null;
  graded_attributes: Record<string, unknown> | null;
  status: string;
  created_at: string;
  /** Null until a custodian logs the stone's physical arrival. */
  custody_received_at: string | null;
  custody_condition_notes: string | null;
  /** False when the received stone diverged from what the seller declared. */
  custody_matches_declared: boolean | null;
  /**
   * End of this stone's reserve escrow term. Caps the claim window of any gift
   * card issued over its token, so a stone without one cannot carry a card.
   */
  reserve_escrow_ends_at: string | null;
}

export interface EvidenceFile {
  id: string;
  category: string;
  mimeType: string;
  sha256: string;
  createdAt: string;
  /**
   * Whether this file may become the public NFT image. Only gemstone media
   * qualifies — certificates name the seller and carry appraisal history, and
   * publication to IPFS cannot be undone. Decided server-side.
   */
  eligibleAsPrimaryImage: boolean;
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

/**
 * Grading choices, served by the same module that prices them.
 *
 * Restating these in the component would let a dropdown offer a value the engine
 * has no price for, and the refusal would only surface after the grader had
 * already assessed the stone.
 */
export interface MatrixOptions {
  version: string;
  varieties: Array<{ name: string; colors: string[]; colorGrades: string[] }>;
  clarities: string[];
  treatments: string[];
  shapes: string[];
  caratRange: { min: number; max: number };
}

export type VerificationMode = 'lab' | 'auto';

export interface QueueResponse {
  organization: string;
  role: 'grader' | 'org_admin' | 'custodian';
  kind: 'lab' | 'admin';
  verificationMode: VerificationMode;
  canManageSettings: boolean;
  /** Admin organisations and members holding the `custodian` role. */
  canConfirmCustody: boolean;
  matrix: MatrixOptions;
  /** Stones physically received and awaiting grading. */
  queue: QueueItem[];
  /** Stones not yet arrived. Empty for members without custody authority. */
  custodyQueue: QueueItem[];
}

/** Returns null when the signed-in user is not an active verifier. */
export async function loadQueue(): Promise<QueueResponse | null> {
  try {
    return await invoke('v1-verification-queue');
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return null;
    throw error;
  }
}

export async function loadSubmission(
  submissionId: string,
): Promise<{ submission: QueueItem; evidence: EvidenceFile[]; matrix: MatrixOptions }> {
  return invoke('v1-verification-queue', { submissionId });
}

/** Only an `org_admin` of an admin organisation may pass a mode. */
export async function setVerificationMode(
  mode: VerificationMode,
): Promise<{ verificationMode: VerificationMode }> {
  return invoke('v1-verification-settings', { mode });
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

export interface GradingResult extends PricePreview {
  activation?: { onchainGemId?: string; transactionHash?: string };
  /** Present when the valuation was recorded but the chain work did not complete. */
  activationState?: 'failed';
  activationError?: string;
}

/**
 * Commits the grading and fires the on-chain transactions.
 *
 * `primaryImageId` names the gemstone photograph that becomes the permanent NFT
 * `image`. It is pinned to IPFS, read back from independent gateways, and its CID
 * sealed into the metadata document before `registerGem` writes that document's
 * URI to a field with no setter — so this choice cannot be revised afterwards.
 */
export async function submitGrading(
  submissionId: string,
  graded: GradeInput,
  primaryImageId?: string,
): Promise<GradingResult> {
  return invoke('v1-verification-grade', { submissionId, graded, primaryImageId });
}

/**
 * Records that a stone physically arrived, releasing it to the grading queue.
 *
 * Nothing on-chain. `GemRegistry.confirmCustody` stays inside the atomic
 * activation sequence; this is the physical event it later attests to.
 */
export async function confirmCustody(
  submissionId: string,
  input: { matchesDeclared: boolean; conditionNotes: string; reserveEscrowEndsAt: string },
): Promise<{ status: string }> {
  return invoke('v1-custody-confirm', {
    submissionId,
    matchesDeclared: input.matchesDeclared,
    conditionNotes: input.conditionNotes,
    reserveEscrowEndsAt: input.reserveEscrowEndsAt,
  });
}

/** Refuses a stone. Writes nothing on-chain and pins nothing. */
export async function rejectSubmission(
  submissionId: string,
  reason: string,
): Promise<{ status: string }> {
  return invoke('v1-verification-grade', { submissionId, action: 'reject', reason });
}

export const ppmToNumber = (ppm: string): number => Number(ppm) / 1_000_000;
// Delegates so the grading portal cannot drift from the rest of the UI; the
// previous integer division floored every fractional dollar.
export const usdFromBaseUnits = (value: string): number => usdFromBase(BigInt(value));

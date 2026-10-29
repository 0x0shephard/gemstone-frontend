/**
 * Pure rules for turning an appraised submission into what reaches the chain.
 *
 * Deliberately free of `npm:` specifiers so the decisions that become permanent
 * (the price, the public attributes, whether a commitment may still change) are
 * unit-testable outside Deno.
 */
import type { PublicAttributes } from './metadataDocument.ts';

/**
 * Columns `sellerAutomation` reads. The two `numeric(78,0)` columns are cast to
 * text: PostgREST returns `numeric` as a JSON number, and a JSON number is an
 * IEEE double. An 18-decimal USD price does not fit in one, so $2,363 read back
 * as `2363000000000000262144` and that drifted value was what reached
 * `verifyGem` and `listGem`.
 */
export const SELLER_SUBMISSION_COLUMNS = [
  'id',
  'deployment_id',
  'seller_id',
  'seller_wallet',
  'gem_name',
  'attributes',
  'sale_mode',
  'metadata_uri',
  'metadata_cid',
  'metadata_document',
  'primary_image_evidence_id',
  'primary_image_cid',
  'status',
  'approved_at',
  'certificate_hash',
  'canonical_payload',
  'commitment_nonce',
  'valuation_method',
  'approved_valuation_usd::text',
  'valuation_hash',
  'valuation_matrix_hash',
  'valuation_canonical_payload',
  'valuation_nonce',
  'onchain_gem_id::text',
  'activation_attempts',
  'activation_started_at',
  'registration_tx_hash',
  'registration_scan_from_block',
  'current_appraisal_id',
  'bank_received_at',
].join(',');

/** The immutable appraisal, with its price read exactly. */
export const APPRAISAL_COLUMNS =
  'id,deployment_id,submission_id,organization_id,graded_inputs,approved_valuation_usd::text,' +
  'matrix_hash,valuation_hash,canonical_payload,nonce,primary_image_evidence_id,' +
  'verifier_organizations(name)';

/**
 * An unsigned integer from a `numeric(78,0)` column, without precision loss.
 *
 * Refuses a JS number outright rather than converting it. By the time a value
 * is a number the damage is done, and `BigInt(number)` faithfully preserves the
 * already-rounded double. The fix is always to select the column `::text`.
 */
export function exactUint(value: unknown, label: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`${label} must not be negative`);
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  if (typeof value === 'number') {
    throw new Error(
      `${label} arrived as a JSON number (${value}); select numeric(78,0) columns as ::text so no precision is lost`,
    );
  }
  throw new Error(`${label} is not an unsigned integer`);
}

/** What the lab graded, exactly as the valuation matrix priced it. */
export interface GradedInputs {
  variety: string;
  caratWeight: number;
  clarity: string;
  treatment: string;
  shape: string;
  color: string;
  colorGrade: string;
}

const GRADED_TEXT_FIELDS = [
  'variety',
  'clarity',
  'treatment',
  'shape',
  'color',
  'colorGrade',
] as const;

export function parseGradedInputs(value: unknown): GradedInputs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The appraisal has no graded attributes');
  }
  const source = value as Record<string, unknown>;
  const graded: Record<string, string> = {};
  for (const field of GRADED_TEXT_FIELDS) {
    const text = source[field];
    if (typeof text !== 'string' || text.trim() === '') {
      throw new Error(`The appraisal is missing graded ${field}`);
    }
    graded[field] = text;
  }
  const caratWeight = source.caratWeight;
  if (typeof caratWeight !== 'number' || !Number.isFinite(caratWeight) || caratWeight <= 0) {
    throw new Error('The appraisal is missing a positive graded carat weight');
  }
  return { ...(graded as Omit<GradedInputs, 'caratWeight'>), caratWeight };
}

/**
 * The public, permanent description of an appraised stone.
 *
 * Every trait is the lab's grade, never the seller's claim. The seller chooses
 * only the display name. Seller-declared fields the lab did not grade (origin,
 * dimensions, the seller's own certificate lab) are left out rather than
 * published under the appraising laboratory's name.
 */
export function publicAttributesFromAppraisal(input: {
  displayName: string;
  graded: GradedInputs;
  laboratory: string;
}): PublicAttributes {
  const name = input.displayName.trim();
  if (!name) throw new Error('The submission has no display name');
  return {
    name,
    gemstoneType: input.graded.variety,
    caratWeight: input.graded.caratWeight,
    color: input.graded.color,
    colorGrade: input.graded.colorGrade,
    clarity: input.graded.clarity,
    cut: input.graded.shape,
    treatment: input.graded.treatment,
    gradingLab: input.laboratory,
  };
}

/** The attributes the evidence commitment binds: precisely the priced inputs. */
export function approvedAttributesFromAppraisal(graded: GradedInputs): GradedInputs {
  return { ...graded };
}

export interface RegistrationProgress {
  onchain_gem_id?: string | number | null;
  registration_tx_hash?: string | null;
  registration_scan_from_block?: string | number | null;
}

/**
 * Whether `registerGem` may already have been sent for this submission.
 *
 * The scan floor is recorded immediately before the broadcast and the hash at
 * broadcast, so either one means a registration might exist on-chain with the
 * stored metadata URI and certificate hash.
 */
export function registrationMayHaveBeenSent(submission: RegistrationProgress): boolean {
  return (
    (submission.onchain_gem_id !== null &&
      submission.onchain_gem_id !== undefined &&
      submission.onchain_gem_id !== '') ||
    Boolean(submission.registration_tx_hash) ||
    (submission.registration_scan_from_block !== null &&
      submission.registration_scan_from_block !== undefined)
  );
}

/**
 * Until registration may have been sent, the commitment and metadata are
 * rebuilt by the server on every preparation, so nothing a seller or an older
 * code path stored can be carried onto the chain. Afterwards they are frozen,
 * because recovery identifies the registered gem by exactly those values.
 */
export function commitmentMayBeRebuilt(submission: RegistrationProgress): boolean {
  return !registrationMayHaveBeenSent(submission);
}

/**
 * Seller-initiated activation.
 *
 * Activation is the administrator's "Start protocol activation" step, recorded
 * as the `seller_activated` workflow event. A seller endpoint therefore never
 * starts it: it reports the result once the administrator has run it and
 * otherwise explains who will. Returns the refusal, or null when the workflow is
 * already activated and the endpoint should simply report the current state.
 */
export function sellerActivationRefusal(projectionState: string | null | undefined): string | null {
  if (projectionState === 'activated') return null;
  return 'Digital Carat starts protocol activation after the bank records receipt of your stone; no action is needed from you';
}

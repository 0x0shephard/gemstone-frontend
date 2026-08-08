import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

type AdminClient = SupabaseClient;

/**
 * Verifier membership and the guards around grading.
 *
 * Labs are Supabase users with a membership row, not wallet holders. The operator
 * key holds `VERIFIER_ROLE` and relays their decision, so authority is checked
 * here rather than on-chain.
 */

export interface VerifierMembership {
  profileId: string;
  organizationId: string;
  organizationName: string;
  kind: 'lab' | 'admin';
  role: 'grader' | 'org_admin' | 'custodian';
  dailyValuationLimit: number;
}

/**
 * Who may attest that a stone physically arrived.
 *
 * The operator address is `gem.custodian` on-chain, so an admin organisation is
 * the party that actually holds the stone and can speak to its arrival. A
 * dedicated `custodian` role exists alongside that so receiving and grading can
 * be separate duties, and so a third-party vault can be onboarded later without
 * granting it grading authority.
 */
export function canConfirmCustody(membership: VerifierMembership): boolean {
  return membership.kind === 'admin' || membership.role === 'custodian';
}

/** Thrown when a member without custody authority tries to record an intake. */
export class NotACustodianError extends Error {
  constructor() {
    super('Confirming custody requires an administrator or custodian membership');
    this.name = 'NotACustodianError';
  }
}

/** Thrown when the caller is not an active verifier. */
export class NotAVerifierError extends Error {
  constructor() {
    super('Not a verifier');
    this.name = 'NotAVerifierError';
  }
}

/** Thrown when an organisation has used up its daily allowance. */
export class ValuationLimitError extends Error {
  constructor(limit: number) {
    super(`Daily valuation limit of ${limit} reached for this organization`);
    this.name = 'ValuationLimitError';
  }
}

export async function requireVerifier(
  admin: AdminClient,
  profileId: string,
): Promise<VerifierMembership> {
  const { data, error } = await admin
    .from('verifier_members')
    .select(
      'profile_id,role,active,organization_id,verifier_organizations(id,name,kind,active,daily_valuation_limit)',
    )
    .eq('profile_id', profileId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;

  const organization = data?.verifier_organizations as
    | {
        id: string;
        name: string;
        kind: 'lab' | 'admin';
        active: boolean;
        daily_valuation_limit: number;
      }
    | undefined;
  if (!data || !organization || !organization.active) throw new NotAVerifierError();

  return {
    profileId,
    organizationId: organization.id,
    organizationName: organization.name,
    kind: organization.kind,
    role: data.role as VerifierMembership['role'],
    dailyValuationLimit: organization.daily_valuation_limit,
  };
}

/**
 * Enforces the per-organisation daily cap.
 *
 * A single lab approval writes a permanent valuation with no second signature, so
 * this bounds how much damage one compromised account can do in a day. It does
 * not replace review; it limits scale.
 */
export async function assertWithinDailyLimit(
  admin: AdminClient,
  membership: VerifierMembership,
): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const { count, error } = await admin
    .from('valuations')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', membership.organizationId)
    .gte('created_at', since);
  if (error) throw error;
  if ((count ?? 0) >= membership.dailyValuationLimit) {
    throw new ValuationLimitError(membership.dailyValuationLimit);
  }
}

/**
 * Queue row as a lab is allowed to see it.
 *
 * Deliberately omits `seller_id`, `seller_wallet`, notes and every other route to
 * the seller's identity. Graders assess the stone and its evidence; knowing whose
 * stone it is serves no grading purpose and creates a conflict of interest.
 */
export const QUEUE_COLUMNS =
  'id,gem_name,carats,attributes,graded_attributes,status,created_at,' +
  // Intake findings travel with the stone: a grader should know the received
  // article diverged from what the seller declared before measuring it.
  'custody_received_at,custody_condition_notes,custody_matches_declared,' +
  // Upper bound on any gift card later issued over this stone's token.
  'reserve_escrow_ends_at';

export interface QueueRow {
  id: string;
  gem_name: string;
  carats: number | null;
  attributes: Record<string, unknown> | null;
  graded_attributes: Record<string, unknown> | null;
  status: string;
  created_at: string;
  custody_received_at: string | null;
  custody_condition_notes: string | null;
  custody_matches_declared: boolean | null;
  reserve_escrow_ends_at: string | null;
}

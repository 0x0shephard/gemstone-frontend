import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type OperationalCapability =
  | 'gemlab.read'
  | 'gemlab.appraise'
  | 'matrix.propose'
  | 'matrix.activate'
  | 'bank.receive'
  | 'custodian.fulfill'
  | 'admin.read'
  | 'admin.correct'
  | 'redemption.approve'
  | 'redemption.recover';

export interface OperationalMembership {
  profileId: string;
  organizationId: string;
  organizationName: string;
  kind: 'lab' | 'gemlab' | 'bank' | 'custodian' | 'admin';
  role: 'grader' | 'gemologist' | 'bank_operator' | 'custody_operator' | 'custodian' | 'org_admin';
  capabilities: OperationalCapability[];
}

const capabilityMatrix: Partial<
  Record<
    OperationalMembership['kind'],
    Partial<Record<OperationalMembership['role'], readonly OperationalCapability[]>>
  >
> = {
  lab: {
    grader: ['gemlab.read', 'gemlab.appraise'],
    gemologist: ['gemlab.read', 'gemlab.appraise'],
    org_admin: ['gemlab.read', 'gemlab.appraise', 'matrix.propose'],
  },
  gemlab: {
    grader: ['gemlab.read', 'gemlab.appraise'],
    gemologist: ['gemlab.read', 'gemlab.appraise'],
    org_admin: ['gemlab.read', 'gemlab.appraise', 'matrix.propose'],
  },
  // The bank or storage vault that holds a stone is also its custodian for
  // redemption: it confirms the request, dispatches the stone and records its
  // arrival, so its members hold the custodian capability too.
  bank: {
    bank_operator: ['bank.receive', 'custodian.fulfill'],
    org_admin: ['bank.receive', 'custodian.fulfill'],
  },
  custodian: {
    custody_operator: ['custodian.fulfill'],
    custodian: ['custodian.fulfill'],
    org_admin: ['custodian.fulfill'],
  },
  admin: {
    // Global matrix activation, corrections and proof approval are deliberately
    // unavailable to incidental roles that happen to belong to an admin org.
    org_admin: [
      'gemlab.read',
      'gemlab.appraise',
      'matrix.propose',
      'matrix.activate',
      'bank.receive',
      'custodian.fulfill',
      'admin.read',
      'admin.correct',
      'redemption.approve',
      'redemption.recover',
    ],
  },
};

export function isGlobalOperationalAdmin(membership: OperationalMembership): boolean {
  return membership.kind === 'admin' && membership.role === 'org_admin';
}

export function capabilitiesFor(
  kind: OperationalMembership['kind'],
  role: OperationalMembership['role'],
): OperationalCapability[] {
  return [...(capabilityMatrix[kind]?.[role] ?? [])];
}

export class MissingCapabilityError extends Error {
  constructor(readonly capability: OperationalCapability) {
    super('Not found');
    this.name = 'MissingCapabilityError';
  }
}

export async function operationalMembership(
  admin: SupabaseClient,
  profileId: string,
  capability: OperationalCapability,
  organizationId?: string,
): Promise<OperationalMembership> {
  let query = admin
    .from('verifier_members')
    .select('profile_id,organization_id,role,active,verifier_organizations(id,name,kind,active)')
    .eq('profile_id', profileId)
    .eq('active', true);
  if (organizationId) query = query.eq('organization_id', organizationId);
  const { data, error } = await query;
  if (error) throw error;

  for (const row of data ?? []) {
    const organization = row.verifier_organizations as unknown as {
      id: string;
      name: string;
      kind: OperationalMembership['kind'];
      active: boolean;
    } | null;
    const role = row.role as OperationalMembership['role'];
    if (!organization?.active) continue;
    const capabilities = capabilitiesFor(organization.kind, role);
    if (!capabilities.includes(capability)) continue;
    return {
      profileId,
      organizationId: organization.id,
      organizationName: organization.name,
      kind: organization.kind,
      role,
      capabilities,
    };
  }
  throw new MissingCapabilityError(capability);
}

export async function allOperationalMemberships(
  admin: SupabaseClient,
  profileId: string,
): Promise<OperationalMembership[]> {
  const { data, error } = await admin
    .from('verifier_members')
    .select('profile_id,organization_id,role,active,verifier_organizations(id,name,kind,active)')
    .eq('profile_id', profileId)
    .eq('active', true);
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const organization = row.verifier_organizations as unknown as {
      id: string;
      name: string;
      kind: OperationalMembership['kind'];
      active: boolean;
    } | null;
    const role = row.role as OperationalMembership['role'];
    if (!organization?.active) return [];
    const capabilities = capabilitiesFor(organization.kind, role);
    if (capabilities.length === 0) return [];
    return [
      {
        profileId,
        organizationId: organization.id,
        organizationName: organization.name,
        kind: organization.kind,
        role,
        capabilities,
      },
    ];
  });
}

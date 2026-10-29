import {
  capabilitiesFor,
  type OperationalCapability,
  type OperationalMembership,
} from './operations.ts';

/**
 * Who is told that a redemption is waiting on them, and what they are told.
 *
 * The gem's on-chain custodian is the server's operator key, so a notice sent
 * to that wallet reached nobody. The people who act are operational members:
 * the Digital Carat admins who accept the request, the bank that stores the
 * stone and dispatches it, and the custodian organization that delivers it.
 */

export interface StaffMemberRow {
  profile_id: string;
  organization_id: string;
  role: string;
  active?: boolean;
  verifier_organizations: { id: string; kind: string; active: boolean } | null;
}

export interface StaffAudience {
  capability: OperationalCapability;
  /** Restrict to one organization; omitted means any organization granting it. */
  organizationId?: string;
}

/** Distinct profiles holding one of the audiences' capabilities, in row order. */
export function staffProfilesFor(rows: StaffMemberRow[], audience: StaffAudience): string[] {
  const profiles = new Set<string>();
  for (const row of rows) {
    const organization = row.verifier_organizations;
    if (row.active === false || !organization?.active) continue;
    if (audience.organizationId && organization.id !== audience.organizationId) continue;
    const capabilities = capabilitiesFor(
      organization.kind as OperationalMembership['kind'],
      row.role as OperationalMembership['role'],
    );
    if (capabilities.includes(audience.capability)) profiles.add(row.profile_id);
  }
  return [...profiles];
}

export interface StaffAlert {
  audience: StaffAudience;
  kind: string;
  title: string;
  body: string;
  actionPath: string;
  actionLabel: string;
}

/** A redemption opened on-chain: admins review it; the storing bank gets a heads-up. */
export function redemptionOpenedAlerts(input: {
  gemId: string;
  bankOrganizationId: string | null;
  custodianOrganizationId: string | null;
}): StaffAlert[] {
  const alerts: StaffAlert[] = [
    {
      audience: { capability: 'redemption.approve' },
      kind: 'redemption.review',
      title: 'A redemption request needs review',
      body:
        `The owner of gemstone #${input.gemId} has asked to take physical delivery, and the ` +
        `token is locked while the request is open. Review it, then accept it and assign the ` +
        `custodian that will deliver the stone.`,
      actionPath: '/verify',
      actionLabel: 'Review the redemption',
    },
  ];
  if (input.bankOrganizationId) {
    alerts.push({
      audience: { capability: 'bank.receive', organizationId: input.bankOrganizationId },
      kind: 'redemption.bank-requested',
      title: 'A stone in your vault is being redeemed',
      body:
        `The owner of gemstone #${input.gemId} has asked to take physical delivery. Once ` +
        `Digital Carat accepts the request, confirm the stone is with you and dispatch it to ` +
        `the assigned custodian.`,
      actionPath: '/bank',
      actionLabel: 'Open the bank queue',
    });
  }
  if (input.custodianOrganizationId) {
    alerts.push(custodianAssignedAlert(input.gemId, input.custodianOrganizationId, null));
  }
  return alerts;
}

/** A redemption accepted by an admin: the assigned bank and custodian act next. */
export function redemptionAcceptedAlerts(input: {
  gemId: string;
  bankOrganizationId: string;
  bankName: string;
  custodianOrganizationId: string;
  custodianName: string;
}): StaffAlert[] {
  return [
    {
      audience: { capability: 'bank.receive', organizationId: input.bankOrganizationId },
      kind: 'redemption.bank-accepted',
      title: 'Redemption accepted: prepare the stone',
      body:
        `Digital Carat accepted the redemption of gemstone #${input.gemId}. Confirm the stone ` +
        `is with you, then dispatch it to ${input.custodianName}.`,
      actionPath: '/bank',
      actionLabel: 'Open the bank queue',
    },
    custodianAssignedAlert(input.gemId, input.custodianOrganizationId, input.bankName),
  ];
}

function custodianAssignedAlert(
  gemId: string,
  organizationId: string,
  bankName: string | null,
): StaffAlert {
  return {
    audience: { capability: 'custodian.fulfill', organizationId },
    kind: 'redemption.custodian-assigned',
    title: 'A redemption delivery is assigned to you',
    body:
      `${bankName ?? 'The storing bank'} will dispatch gemstone #${gemId} to you. When it ` +
      `reaches the pickup point or the holder's address, record the arrival so the owner can ` +
      `authorize the handover.`,
    actionPath: '/custodian',
    actionLabel: 'Open the custodian queue',
  };
}

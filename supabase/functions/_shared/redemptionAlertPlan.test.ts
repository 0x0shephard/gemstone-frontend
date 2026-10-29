import { describe, expect, it } from 'vitest';
import { ownerCodeEmailKey } from './ownerCodeDelivery';
import {
  redemptionAcceptedAlerts,
  redemptionOpenedAlerts,
  staffProfilesFor,
  type StaffMemberRow,
} from './redemptionAlertPlan';

const org = (id: string, kind: string, active = true) => ({ id, kind, active });
const rows: StaffMemberRow[] = [
  {
    profile_id: 'admin-1',
    organization_id: 'dc',
    role: 'org_admin',
    verifier_organizations: org('dc', 'admin'),
  },
  // A non-admin role in the admin org cannot approve redemptions.
  {
    profile_id: 'admin-grader',
    organization_id: 'dc',
    role: 'grader',
    verifier_organizations: org('dc', 'admin'),
  },
  {
    profile_id: 'bank-1',
    organization_id: 'bank-a',
    role: 'bank_operator',
    verifier_organizations: org('bank-a', 'bank'),
  },
  {
    profile_id: 'bank-2',
    organization_id: 'bank-b',
    role: 'bank_operator',
    verifier_organizations: org('bank-b', 'bank'),
  },
  {
    profile_id: 'custody-1',
    organization_id: 'vault',
    role: 'custody_operator',
    verifier_organizations: org('vault', 'custodian'),
  },
  {
    profile_id: 'custody-off',
    organization_id: 'old',
    role: 'custodian',
    verifier_organizations: org('old', 'custodian', false),
  },
  {
    profile_id: 'lab-1',
    organization_id: 'lab',
    role: 'grader',
    verifier_organizations: org('lab', 'lab'),
  },
];

describe('redemption staff alerts', () => {
  it('sends the review alert to Digital Carat admins, not to the operator wallet', () => {
    const [review] = redemptionOpenedAlerts({
      gemId: '12',
      bankOrganizationId: null,
      custodianOrganizationId: null,
    });
    expect(review.kind).toBe('redemption.review');
    expect(staffProfilesFor(rows, review.audience)).toEqual(['admin-1']);
  });

  it('tells only the storing bank, and the custodian once one is assigned', () => {
    const alerts = redemptionOpenedAlerts({
      gemId: '12',
      bankOrganizationId: 'bank-a',
      custodianOrganizationId: 'vault',
    });
    expect(alerts.map((alert) => staffProfilesFor(rows, alert.audience))).toEqual([
      ['admin-1'],
      ['bank-1'],
      ['custody-1'],
    ]);
  });

  it('tells the assigned bank and custodian when the request is accepted', () => {
    const alerts = redemptionAcceptedAlerts({
      gemId: '12',
      bankOrganizationId: 'bank-b',
      bankName: 'Bank B',
      custodianOrganizationId: 'vault',
      custodianName: 'Vault Co',
    });
    expect(alerts.map((alert) => staffProfilesFor(rows, alert.audience))).toEqual([
      ['bank-2'],
      ['custody-1'],
    ]);
    expect(alerts[0].body).toContain('Vault Co');
    expect(alerts[1].body).toContain('Bank B');
  });

  it('skips inactive organizations and memberships', () => {
    expect(
      staffProfilesFor(rows, { capability: 'custodian.fulfill', organizationId: 'old' }),
    ).toEqual([]);
    expect(
      staffProfilesFor([{ ...rows[2], active: false }], {
        capability: 'bank.receive',
        organizationId: 'bank-a',
      }),
    ).toEqual([]);
  });

  it('no longer tells anyone to confirm the handover', () => {
    const copy = [
      ...redemptionOpenedAlerts({
        gemId: '1',
        bankOrganizationId: 'bank-a',
        custodianOrganizationId: 'vault',
      }),
      ...redemptionAcceptedAlerts({
        gemId: '1',
        bankOrganizationId: 'bank-a',
        bankName: 'A',
        custodianOrganizationId: 'vault',
        custodianName: 'V',
      }),
    ]
      .map((alert) => alert.body)
      .join(' ');
    expect(copy).not.toMatch(/confirm the handover|reserve is released to you/i);
  });
});

describe('owner-code resend', () => {
  it('sends a resend under a new provider key, once per resend request', () => {
    const first = ownerCodeEmailKey('arb', 'generation-1');
    const resend = ownerCodeEmailKey('arb', 'generation-1', 'click-1');
    expect(resend).not.toBe(first);
    expect(ownerCodeEmailKey('arb', 'generation-1', 'click-2')).not.toBe(resend);
    expect(ownerCodeEmailKey('arb', 'generation-1', 'click-1')).toBe(resend);
  });
});

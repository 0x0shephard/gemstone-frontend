import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { NotAVerifierError, requireVerifier } from './verifier.ts';
import { MissingCapabilityError, operationalMembership } from './operations.ts';

interface Row {
  role: string;
  organization_id: string;
  verifier_organizations: {
    id: string;
    name: string;
    kind: string;
    active: boolean;
    daily_valuation_limit?: number;
  } | null;
}

/** A client whose membership query resolves to `rows`, and errors like PostgREST on `.maybeSingle()` with more than one. */
function clientWith(rows: Row[]): SupabaseClient {
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      if (column === 'organization_id') {
        return { ...query, then: resolveWith(rows.filter((row) => row.organization_id === value)) };
      }
      return query;
    },
    maybeSingle: async () =>
      rows.length > 1
        ? {
            data: null,
            error: { message: 'JSON object requested, multiple (or no) rows returned' },
          }
        : { data: rows[0] ?? null, error: null },
    then: resolveWith(rows),
  };
  return { from: () => query } as unknown as SupabaseClient;
}

function resolveWith(rows: Row[]) {
  return (resolve: (value: { data: Row[]; error: null }) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
}

const organization = (id: string, kind: string, active = true) => ({
  id,
  name: `${kind} ${id}`,
  kind,
  active,
  daily_valuation_limit: 25,
});

describe('legacy verifier membership', () => {
  it('tolerates a person who belongs to more than one organisation', async () => {
    const membership = await requireVerifier(
      clientWith([
        {
          role: 'bank_operator',
          organization_id: 'b',
          verifier_organizations: organization('b', 'bank'),
        },
        { role: 'grader', organization_id: 'l', verifier_organizations: organization('l', 'lab') },
      ]),
      'profile',
    );
    expect(membership).toMatchObject({ organizationId: 'l', kind: 'lab', role: 'grader' });
  });

  it('chooses deterministically: admin, then custodian role, then lab', async () => {
    const rows: Row[] = [
      { role: 'grader', organization_id: 'l', verifier_organizations: organization('l', 'lab') },
      { role: 'custodian', organization_id: 'c', verifier_organizations: organization('c', 'lab') },
      {
        role: 'org_admin',
        organization_id: 'a',
        verifier_organizations: organization('a', 'admin'),
      },
    ];
    expect((await requireVerifier(clientWith(rows), 'p')).organizationId).toBe('a');
    expect((await requireVerifier(clientWith(rows.slice(0, 2)), 'p')).organizationId).toBe('c');
    expect((await requireVerifier(clientWith([...rows.slice(0, 2)].reverse()), 'p')).role).toBe(
      'custodian',
    );
  });

  it('ignores inactive organisations and refuses when none is left', async () => {
    await expect(
      requireVerifier(
        clientWith([
          {
            role: 'grader',
            organization_id: 'l',
            verifier_organizations: organization('l', 'lab', false),
          },
        ]),
        'p',
      ),
    ).rejects.toBeInstanceOf(NotAVerifierError);
  });
});

describe('capability membership used by custody confirmation', () => {
  const rows: Row[] = [
    { role: 'grader', organization_id: 'l', verifier_organizations: organization('l', 'lab') },
    {
      role: 'bank_operator',
      organization_id: 'b',
      verifier_organizations: organization('b', 'bank'),
    },
  ];

  it('finds the bank membership among several, so bank staff are not refused', async () => {
    const membership = await operationalMembership(clientWith(rows), 'p', 'bank.receive');
    expect(membership).toMatchObject({ organizationId: 'b', kind: 'bank' });
  });

  it('refuses a person with no custody capability', async () => {
    await expect(
      operationalMembership(clientWith(rows.slice(0, 1)), 'p', 'bank.receive'),
    ).rejects.toBeInstanceOf(MissingCapabilityError);
  });
});

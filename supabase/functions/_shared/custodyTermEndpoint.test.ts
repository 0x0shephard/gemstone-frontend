import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const endpoint = readFileSync(
  join(process.cwd(), 'supabase/functions/v1-custody-confirm/index.ts'),
  'utf8',
);
const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/202610020004_gem_custody_terms.sql'),
  'utf8',
);

describe('missing custody term repair', () => {
  it('verifies the active on-chain gem and live token before accepting an attestation', () => {
    const record = endpoint.slice(endpoint.indexOf("if (body.action === 'record_term')"));
    expect(record).toContain("functionName: 'getGem'");
    expect(record).toContain("functionName: 'ownerOf'");
    expect(record).toContain('isGlobalOperationalAdmin(membership) && operatorCustodied');
    expect(record).toContain(".from('wallet_links')");
    expect(record).toContain('getAddress(walletAddress) === getAddress(gem.custodian)');
  });

  it('lets bank staff through the capability model, but only for stones their bank received', () => {
    expect(endpoint).not.toContain('await requireVerifier(');
    expect(endpoint).toMatch(
      /CUSTODY_CAPABILITIES: readonly OperationalCapability\[\] = \[\s*'bank\.receive',\s*'custodian\.fulfill',?\s*\]/,
    );
    expect(endpoint).toContain(
      'operationalMembership(admin, profileId, capability, organizationId)',
    );
    const record = endpoint.slice(endpoint.indexOf("if (body.action === 'record_term')"));
    const bank = record.slice(record.indexOf("membership.kind === 'bank'"));
    expect(bank).toContain(".eq('bank_organization_id', membership.organizationId)");
    expect(bank).toContain(".eq('onchain_gem_id', term.gemId)");
  });

  it('cannot overwrite either a seller intake term or a prior attestation', () => {
    const record = endpoint.slice(endpoint.indexOf("if (body.action === 'record_term')"));
    expect(record).toContain(".from('seller_submissions')");
    expect(record).toContain(".from('gem_custody_terms')");
    expect(record).toContain('cannot be overwritten');
    expect(record).toContain("insertError?.code === '23505'");
    expect(migration).toContain('primary key (deployment_id, gem_id)');
    expect(migration).toContain('before update or delete');
    expect(migration).toContain('Gem custody terms are append-only');
  });

  it('keeps the attestation private and deployment scoped', () => {
    expect(migration).toContain('deployment_id text not null');
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('revoke all on public.gem_custody_terms from anon, authenticated');
    expect(endpoint).toContain('deployment_id: deployment.id');
    expect(endpoint).not.toContain('attestationNote: term.attestationNote');
  });

  it('preserves immutable attribution without blocking auth-user deletion', () => {
    expect(migration).toContain('recorded_by uuid not null');
    expect(migration).not.toMatch(
      /recorded_by uuid[^,]*references\s+auth\.users[^,]*on delete set null/i,
    );
    expect(migration).toContain('Deliberately has no auth.users FK');
    expect(migration).toContain('before update or delete');
  });
});

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
    expect(record).toContain("membership.kind === 'admin'");
    expect(record).toContain(".from('wallet_links')");
    expect(record).toContain('getAddress(walletAddress) === getAddress(gem.custodian)');
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

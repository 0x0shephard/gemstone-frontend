import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPERATOR_LEASE_NAME } from './operatorLease.ts';

const source = (relative: string) =>
  readFileSync(join(process.cwd(), 'supabase/functions', relative), 'utf8');

describe('one operator lease for every operator-key writer', () => {
  it('keeps the stored lease name every running writer shares', () => {
    expect(OPERATOR_LEASE_NAME).toBe('sepolia-seller-activation');
    expect(source('_shared/giftTransferLease.ts')).toContain(
      `const OPERATOR_LEASE = '${OPERATOR_LEASE_NAME}'`,
    );
    expect(
      readFileSync(
        join(process.cwd(), 'supabase/migrations/202607250003_operator_lease.sql'),
        'utf8',
      ),
    ).toContain(`values ('${OPERATOR_LEASE_NAME}')`);
  });

  it('is what seller activation claims', () => {
    const automation = source('_shared/sellerAutomation.ts');
    expect(automation).toContain("from './operatorLease.ts'");
    expect(automation).not.toContain("'sepolia-seller-activation'");
  });

  it('is held by the auction sweep around every send', () => {
    const sweep = source('v1-auction-refresh/index.ts');
    const claim = sweep.indexOf('leaseClaimed = await claimOperatorLease(admin, leaseHolder');
    expect(claim).toBeGreaterThan(-1);
    expect(sweep).toContain('const leaseHolder = crypto.randomUUID()');
    // The only direct call is inside the lease-renewing wrapper.
    expect(sweep.match(/writeAndConfirm\(/g)).toHaveLength(1);
    expect(sweep).toContain('renewOperatorLease(admin, leaseHolder, OPERATOR_LEASE_MS)');
    expect(sweep.indexOf('await send(')).toBeGreaterThan(claim);
    expect(sweep).toContain('if (leaseClaimed) await releaseOperatorLease(admin, leaseHolder)');
  });
});

describe('gem lab workflow controls', () => {
  const gemlab = source('v1-gemlab-workflow/index.ts');

  it('offers a versioned reject action, authorised like appraise', () => {
    expect(gemlab).toContain(
      "['appraise', 'preview', 'reject'].includes(action) ? 'gemlab.appraise'",
    );
    const reject = gemlab.slice(gemlab.indexOf("if (action === 'reject')"));
    expect(reject).toContain("admin.rpc('reject_gem_submission'");
    expect(reject).toContain('p_idempotency_key: idempotencyKey');
    expect(reject).toContain('p_expected_version: expectedVersion');
    expect(reject).toContain("'gemlab.rejected'");
  });

  it('reports the daily valuation limit as 429', () => {
    expect(gemlab).toContain("recordError.code === 'DC001'");
    expect(gemlab).toMatch(/DC001'\) return json\(\{ error: recordError\.message \}, 429\)/);
  });

  it('returns exact appraisal prices', () => {
    expect(gemlab).toContain('approved_valuation_usd::text');
    expect(gemlab).toContain('approvedValuationUsd: valuation.approvedValuationUsd.toString()');
    expect(gemlab).not.toContain('String(appraisal.approved_valuation_usd)');
  });
});

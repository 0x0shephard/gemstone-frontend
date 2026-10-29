import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPublicMetadata } from './metadataDocument.ts';
import {
  APPRAISAL_COLUMNS,
  SELLER_SUBMISSION_COLUMNS,
  approvedAttributesFromAppraisal,
  commitmentMayBeRebuilt,
  exactUint,
  parseGradedInputs,
  publicAttributesFromAppraisal,
  registrationMayHaveBeenSent,
  sellerActivationRefusal,
} from './sellerOnboarding.ts';

const functionsDir = join(process.cwd(), 'supabase/functions');
const source = (relative: string) => readFileSync(join(functionsDir, relative), 'utf8');

/** What the seller said. */
const claimed = {
  name: 'Ruby Horizon',
  gemstoneType: 'Ruby',
  caratWeight: 3.4,
  origin: 'Burma',
  dimensions: '9 x 7 x 5 mm',
  color: 'Pigeon blood',
  clarity: 'IF',
  cut: 'Cushion',
  treatment: 'None',
  gradingLab: 'Seller Certificate Co',
  certificateNumber: 'X-1',
};

/** What the lab graded, and what the matrix priced. */
const graded = {
  variety: 'ruby',
  caratWeight: 2.05,
  clarity: 'si1',
  treatment: 'heated',
  shape: 'oval',
  color: 'red',
  colorGrade: 'medium',
};

describe('lab-graded public attributes', () => {
  const publicAttributes = publicAttributesFromAppraisal({
    displayName: claimed.name,
    graded,
    laboratory: 'Digital Carat Gem Lab',
  });

  it('publishes the lab grades, not the seller claims', () => {
    expect(publicAttributes).toEqual({
      name: 'Ruby Horizon',
      gemstoneType: 'ruby',
      caratWeight: 2.05,
      color: 'red',
      colorGrade: 'medium',
      clarity: 'si1',
      cut: 'oval',
      treatment: 'heated',
      gradingLab: 'Digital Carat Gem Lab',
    });
  });

  it('leaves out seller-declared fields the lab never graded', () => {
    const metadata = buildPublicMetadata(publicAttributes, { chainId: 42161 });
    const values = metadata.attributes.map((attribute) => String(attribute.value));
    for (const claim of ['Burma', '9 x 7 x 5 mm', 'Pigeon blood', 'IF', 'Seller Certificate Co']) {
      expect(values).not.toContain(claim);
    }
    expect(metadata.attributes).toContainEqual({ trait_type: 'Carat Weight', value: 2.05 });
    expect(metadata.attributes).toContainEqual({
      trait_type: 'Certification Lab',
      value: 'Digital Carat Gem Lab',
    });
  });

  it('commits exactly the inputs the valuation priced', () => {
    expect(approvedAttributesFromAppraisal(graded)).toEqual(graded);
    expect(approvedAttributesFromAppraisal(graded)).not.toBe(graded);
  });

  it('refuses an appraisal without complete grades', () => {
    expect(() => parseGradedInputs({ ...graded, colorGrade: '' })).toThrow(/colorGrade/);
    expect(() => parseGradedInputs({ ...graded, caratWeight: '2.05' })).toThrow(/carat weight/);
    expect(() => parseGradedInputs(null)).toThrow(/no graded attributes/);
    expect(parseGradedInputs(graded)).toEqual(graded);
  });

  it('is what activation feeds the metadata and the commitment', () => {
    const automation = source('_shared/sellerAutomation.ts');
    expect(automation).toContain('publicAttributesFromAppraisal({');
    expect(automation).toContain('approvedAttributes: approvedAttributesFromAppraisal(');
    expect(automation).not.toContain('approvedAttributes: submission.attributes');
    expect(automation).not.toContain('publishMetadata(submission.attributes');
    expect(automation).toContain(".from('gem_appraisals')");
  });
});

describe('exact numeric(78,0) values', () => {
  // $2,363 at 18 decimals, as PostgREST used to hand it back.
  const asJsonNumber = 2363e18;

  it('shows the precision loss the cast prevents', () => {
    expect(BigInt(asJsonNumber).toString()).toBe('2363000000000000262144');
  });

  it('reads the exact value from text', () => {
    expect(exactUint('2363000000000000000000', 'price')).toBe(2_363n * 10n ** 18n);
    expect(exactUint(' 7 ', 'gem')).toBe(7n);
    expect(exactUint(5n, 'gem')).toBe(5n);
  });

  it('refuses a JSON number instead of converting the already-rounded double', () => {
    expect(() => exactUint(asJsonNumber, 'Approved valuation')).toThrow(/::text/);
    expect(() => exactUint(1, 'gem')).toThrow(/JSON number/);
  });

  it('refuses anything that is not an unsigned integer', () => {
    for (const value of ['', '-1', '1.5', '0x10', null, undefined, -1n]) {
      expect(() => exactUint(value, 'price')).toThrow();
    }
  });

  it('casts every numeric(78,0) column activation reads', () => {
    expect(SELLER_SUBMISSION_COLUMNS.split(',')).toContain('approved_valuation_usd::text');
    expect(SELLER_SUBMISSION_COLUMNS.split(',')).toContain('onchain_gem_id::text');
    expect(SELLER_SUBMISSION_COLUMNS).not.toMatch(/(^|,)approved_valuation_usd(,|$)/);
    expect(APPRAISAL_COLUMNS).toContain('approved_valuation_usd::text');
    const automation = source('_shared/sellerAutomation.ts');
    expect(automation).toContain('.select(SELLER_SUBMISSION_COLUMNS)');
    expect(automation).not.toMatch(/BigInt\(submission\.approved_valuation_usd\)/);
    expect(automation).toContain(
      "exactUint(submission.approved_valuation_usd, 'Approved valuation')",
    );
  });

  /**
   * Every Edge Function select list that names a `numeric(78,0)` column must
   * cast it. Gift and redemption code is audited separately and excluded here.
   */
  it('finds no uncast numeric(78,0) column in an onboarding select list', () => {
    const numeric = ['approved_valuation_usd', 'onchain_gem_id', 'gem_id', 'token_id'];
    const excluded =
      /^(v1-gift-|v1-redemption-|v1-notify-sweep)|_shared\/(gift|redemption|receiptValidation)/;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) files.push(path);
      }
    };
    walk(functionsDir);
    const offenders: string[] = [];
    for (const path of files) {
      const relative = path.slice(functionsDir.length + 1);
      if (excluded.test(relative)) continue;
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(/\.select\(\s*((?:'[^']*'\s*\+?\s*)+)/g)) {
        const list = match[1].replace(/'\s*\+\s*'/g, '').replace(/'/g, '');
        for (const column of list.split(/[,()]/).map((part) => part.trim())) {
          if (numeric.includes(column)) offenders.push(`${relative}: ${column}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('when the on-chain package is frozen', () => {
  it('rebuilds the commitment only while no registration can have been sent', () => {
    expect(commitmentMayBeRebuilt({})).toBe(true);
    expect(
      commitmentMayBeRebuilt({
        onchain_gem_id: null,
        registration_tx_hash: null,
        registration_scan_from_block: null,
      }),
    ).toBe(true);
    for (const sent of [
      { registration_scan_from_block: 519_400_000 },
      { registration_tx_hash: `0x${'ab'.repeat(32)}` },
      { onchain_gem_id: '3' },
    ]) {
      expect(registrationMayHaveBeenSent(sent)).toBe(true);
      expect(commitmentMayBeRebuilt(sent)).toBe(false);
    }
  });

  it('no longer trusts a stored commitment just because one exists', () => {
    const automation = source('_shared/sellerAutomation.ts');
    expect(automation).toContain('if (commitmentMayBeRebuilt(submission)) {');
    expect(automation).not.toContain(
      'if (!submission.certificate_hash || !submission.canonical_payload)',
    );
    expect(automation).toContain('certificateDigestsFromStorage(admin, submissionId)');
  });

  it('closes the seller endpoint that wrote its own commitment', () => {
    const endpoint = source('v1-seller-commitment/index.ts');
    expect(endpoint).not.toMatch(/\.update\(/);
    expect(endpoint).not.toContain('createCommitment');
    expect(endpoint).not.toContain(".from('evidence_files')");
  });
});

describe('registration transaction hash', () => {
  const automation = source('_shared/sellerAutomation.ts');
  const register = automation.slice(automation.indexOf("functionName: 'registerGem'"));

  it('is persisted at broadcast through the lifecycle callback, not after the receipt', () => {
    const callback = register.indexOf('onSubmitted: async (hash) =>');
    const persisted = register.indexOf('registration_tx_hash: hash', callback);
    const receipt = register.indexOf('getTransactionReceipt({ hash: latestHash })');
    expect(callback).toBeGreaterThan(-1);
    expect(persisted).toBeGreaterThan(callback);
    expect(receipt).toBeGreaterThan(persisted);
    expect(register).not.toContain('registration_tx_hash: latestHash');
  });

  it('records the scan floor before the broadcast', () => {
    expect(automation.indexOf('registration_scan_from_block: Number(')).toBeLessThan(
      automation.indexOf("functionName: 'registerGem'"),
    );
  });

  it('treats a recorded hash that is still pending as a reason to stop, not to register again', () => {
    expect(automation).toContain('.getTransaction({ hash: hash as Hash })');
    expect(automation).toMatch(/is still pending; retry once it is mined/);
  });

  it('relies on chain.ts calling onSubmitted before waiting for the receipt', () => {
    const chain = source('_shared/chain.ts');
    expect(chain.indexOf('await onSubmitted?.(hash)')).toBeLessThan(
      chain.indexOf('waitForTransactionReceipt'),
    );
  });
});

describe('seller-initiated activation', () => {
  it('refuses until the administrator has started and completed activation', () => {
    for (const state of [undefined, null, 'submitted', 'appraised', 'bank_received']) {
      expect(sellerActivationRefusal(state)).toMatch(/Digital Carat starts protocol activation/);
    }
    expect(sellerActivationRefusal('activated')).toBeNull();
  });

  it('is never run by a seller endpoint', () => {
    for (const endpoint of ['v1-seller-activate/index.ts', 'v1-seller-submit/index.ts']) {
      const text = source(endpoint);
      expect(text).not.toContain('activateSellerSubmission');
      expect(text).toContain('sellerActivationRefusal(projection?.current_state)');
    }
    const admin = source('v1-admin-operations/index.ts');
    const start = admin.slice(admin.indexOf("action === 'start_seller_activation'"));
    expect(start).toContain('activateSellerSubmission(admin, submissionId');
    expect(start).toContain("eventType: 'seller_activated'");
  });
});

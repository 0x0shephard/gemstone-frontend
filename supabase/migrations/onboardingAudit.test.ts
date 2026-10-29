import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keccak256, toBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import { canonicalize } from '../functions/_shared/canonicalJson.ts';
import { VALUATION_MATRIX } from '../functions/_shared/valuationMatrix.ts';

const migration = (name: string) =>
  readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8');
const lifecycle = migration('202610030001_operational_lifecycles.sql');
const matrixSeed = migration('202610300101_valuation_matrix_for_every_deployment.sql');
const evidence = migration('202610300102_seller_evidence_editable_only_before_review.sql');
const gemlab = migration('202610300103_gemlab_daily_limit_and_rejection.sql');
const arbitrum = migration('202610290001_stage_arbitrum_one_519342582.sql');

const dollarQuoted = (sql: string, tag: string) => {
  const open = `$${tag}$`;
  const start = sql.indexOf(open) + open.length;
  return sql.slice(start, sql.indexOf(open, start));
};
const hashIn = (sql: string) => sql.match(/'(0x[0-9a-f]{64})'/)?.[1];

describe('202610300101 valuation matrix for every deployment', () => {
  it('seeds byte-for-byte the v3 snapshot the original migration seeded', () => {
    expect(dollarQuoted(matrixSeed, 'matrix')).toBe(dollarQuoted(lifecycle, 'matrix'));
    expect(dollarQuoted(matrixSeed, 'canonical')).toBe(dollarQuoted(lifecycle, 'canonical'));
    expect(hashIn(matrixSeed)).toBe(hashIn(lifecycle));
    expect(matrixSeed).toContain("'digital-carat-matrix-v3'");
    expect(matrixSeed).toContain("'active'");
  });

  it('seeds a document whose canonical form and hash match the in-code matrix', () => {
    const document = JSON.parse(dollarQuoted(matrixSeed, 'matrix'));
    const inCode = JSON.parse(
      JSON.stringify(VALUATION_MATRIX, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
    expect(document).toEqual(inCode);
    const canonical = canonicalize(document);
    expect(canonical).toBe(dollarQuoted(matrixSeed, 'canonical'));
    expect(keccak256(toBytes(canonical))).toBe(hashIn(matrixSeed));
  });

  it('backfills every deployment, idempotently, without a second active row', () => {
    expect(matrixSeed).toMatch(
      /select public\.seed_default_valuation_matrix\(id\) from public\.protocol_deployments;/,
    );
    expect(matrixSeed).toMatch(/on conflict do nothing/);
    expect(matrixSeed).toMatch(
      /if exists \(\s*select 1 from public\.valuation_matrix_versions\s*where deployment_id = p_deployment_id and state = 'active'/,
    );
  });

  it('covers the Arbitrum One deployment, which was staged after the original seed', () => {
    // The original seed ran `insert ... select from protocol_deployments` in
    // 202610030001; the Arbitrum row did not exist until 202610290001.
    expect(arbitrum).toContain("'arbitrum-one-519342582'");
    expect('202610290001' < '202610300101').toBe(true);
  });

  it('gives every future deployment a matrix in the same transaction as its insert', () => {
    expect(matrixSeed).toMatch(
      /create trigger protocol_deployment_seeds_valuation_matrix\s+after insert on public\.protocol_deployments\s+for each row execute function public\.seed_valuation_matrix_for_new_deployment\(\);/,
    );
    expect(matrixSeed).toContain('perform public.seed_default_valuation_matrix(new.id);');
  });

  it('keeps the seed function service-only and deletes nothing', () => {
    expect(matrixSeed).toContain(
      'revoke all on function public.seed_default_valuation_matrix(text) from public, anon, authenticated;',
    );
    expect(matrixSeed).not.toMatch(/\b(delete\s+from|truncate|drop\s+table|update\s+public\.)/i);
  });
});

describe('202610300102 seller evidence is frozen once review begins', () => {
  const policy = (name: string) => {
    const start = evidence.indexOf(`create policy ${name}`);
    return evidence.slice(start, evidence.indexOf(');\n', start));
  };

  it.each(['evidence_insert_own', 'evidence_delete_own'])(
    '%s allows changes only while the submission is editable',
    (name) => {
      const body = policy(name);
      expect(evidence).toContain(`drop policy if exists ${name} on public.evidence_files;`);
      expect(body).toContain("status in ('submitted', 'changes_requested')");
      expect(body).toContain('current_appraisal_id is null');
      expect(body).toContain('certificate_hash is null');
      expect(body).toContain('onchain_gem_id is null');
      expect(body).toContain('seller_id = auth.uid()');
      expect(body).toContain('deployment_id = public.requested_protocol_deployment_id()');
    },
  );

  it('freezes no review state: custody, grading and approval are all excluded', () => {
    for (const status of ['awaiting_custody', 'awaiting_grading', 'approved', 'registered']) {
      expect(policy('evidence_insert_own')).not.toContain(`'${status}'`);
      expect(policy('evidence_delete_own')).not.toContain(`'${status}'`);
    }
  });

  it('keeps redemption documents, which have no submission, working', () => {
    expect(policy('evidence_insert_own')).toContain(
      "(submission_id is null and category = 'redemption_document')",
    );
    expect(policy('evidence_delete_own')).toContain('submission_id is null');
  });

  it('stops the bytes behind a reviewed evidence row being deleted and replaced', () => {
    const storage = policy('private_delete_own_prefix');
    expect(storage).toContain('on storage.objects for delete');
    expect(storage).toContain(
      "public.seller_submissions.status not in ('submitted', 'changes_requested')",
    );
    expect(storage).toContain('public.seller_submissions.current_appraisal_id is not null');
  });

  it('runs after the policies it replaces', () => {
    expect('202610020003' < '202610300102').toBe(true);
  });
});

describe('202610300103 gem lab daily limit and rejection', () => {
  const appraisal = gemlab.slice(
    gemlab.indexOf('create or replace function public.record_gem_appraisal('),
    gemlab.indexOf('revoke all on function public.record_gem_appraisal('),
  );

  it('enforces the organisation limit atomically, under record_valuation’s lock key', () => {
    expect(appraisal).toContain(
      'perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));',
    );
    expect(migration('202608170002_valuation_limit_atomic.sql')).toContain(
      'pg_advisory_xact_lock(hashtextextended(organization::text, 0))',
    );
    expect(appraisal).toContain('select daily_valuation_limit into allowed');
    expect(appraisal).toContain("errcode = 'DC001'");
    expect(appraisal).toContain("interval '24 hours'");
  });

  it('checks the limit after the idempotent replay and before the insert', () => {
    const replay = appraisal.indexOf('return appraisal;\n  end if;');
    const limit = appraisal.indexOf('pg_advisory_xact_lock');
    const insert = appraisal.indexOf('insert into public.gem_appraisals(');
    expect(replay).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(replay);
    expect(insert).toBeGreaterThan(limit);
  });

  it('otherwise keeps the appraisal function as it was', () => {
    const original = lifecycle.slice(
      lifecycle.indexOf('create or replace function public.record_gem_appraisal('),
      lifecycle.indexOf('create or replace function public.record_bank_receipt('),
    );
    const withoutLimit = appraisal
      .replace(
        /\n {2}-- The organisation's rolling 24-hour allowance[\s\S]*?end if;\n(?=\n {2}insert)/,
        '',
      )
      .replace('  allowed integer;\n  used bigint;\n', '');
    expect(withoutLimit.trim()).toBe(original.trim());
  });

  it('rejects in one transaction with its workflow event', () => {
    const reject = gemlab.slice(
      gemlab.indexOf('create or replace function public.reject_gem_submission('),
    );
    expect(reject).toContain('for update');
    expect(reject).toContain("status = 'rejected'");
    expect(reject).toContain("'gem_rejected', 'rejected'");
    expect(reject).toContain("'gemlab.appraise'");
    expect(reject).toContain("submission.status not in ('awaiting_custody', 'awaiting_grading')");
    expect(reject).toContain('submission.current_appraisal_id is not null');
    expect(reject).toContain('idempotency_key = p_idempotency_key');
  });

  it('keeps both functions service-only', () => {
    expect(gemlab).toMatch(
      /revoke all on function public\.record_gem_appraisal\([^)]*\)\s+from public,anon,authenticated;/,
    );
    expect(gemlab).toMatch(
      /revoke all on function public\.reject_gem_submission\([^)]*\)\s+from public, anon, authenticated;/,
    );
  });
});

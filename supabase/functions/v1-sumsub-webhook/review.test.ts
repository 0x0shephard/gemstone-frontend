// @vitest-environment node
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  digestAlgorithm,
  parseSumsubEvent,
  parseSumsubTime,
  signatureValid,
  statusFromReview,
} from './review.ts';

const PROFILE = '8f14e45f-ceea-467a-9575-5bd1c2f4b2a1';

function event(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    applicantId: '65f0c0ffee',
    inspectionId: '65f0c0ffef',
    correlationId: 'req-1',
    externalUserId: PROFILE,
    levelName: 'basic-kyc-level',
    type: 'applicantReviewed',
    reviewStatus: 'completed',
    reviewResult: { reviewAnswer: 'GREEN' },
    createdAtMs: '2026-10-30 09:15:02.123',
    createdAt: '2026-10-30 09:15:02+0000',
    ...overrides,
  });
}

describe('parseSumsubTime', () => {
  it('reads both Sumsub formats as UTC', () => {
    expect(parseSumsubTime('2026-10-30 09:15:02.123')?.toISOString()).toBe(
      '2026-10-30T09:15:02.123Z',
    );
    expect(parseSumsubTime('2026-10-30 09:15:02+0000')?.toISOString()).toBe(
      '2026-10-30T09:15:02.000Z',
    );
    expect(parseSumsubTime('2026-10-30T11:15:02+02:00')?.toISOString()).toBe(
      '2026-10-30T09:15:02.000Z',
    );
  });

  it('refuses what is not a time', () => {
    expect(parseSumsubTime('yesterday')).toBeNull();
    expect(parseSumsubTime(undefined)).toBeNull();
    expect(parseSumsubTime(1730279702)).toBeNull();
  });
});

describe('statusFromReview', () => {
  it('approves only a completed GREEN review', () => {
    expect(statusFromReview('completed', { reviewAnswer: 'GREEN' }, 'applicantReviewed')).toBe(
      'approved',
    );
    expect(
      statusFromReview(
        'completed',
        { reviewAnswer: 'RED', reviewRejectType: 'RETRY' },
        'applicantReviewed',
      ),
    ).toBe('rejected');
    expect(statusFromReview('completed', null, 'applicantReviewed')).toBe('rejected');
  });

  it('maps in-progress, held and reset applicants', () => {
    expect(statusFromReview('pending', null, 'applicantPending')).toBe('pending');
    expect(statusFromReview('init', null, 'applicantCreated')).toBe('pending');
    expect(statusFromReview('onHold', null, 'applicantOnHold')).toBe('on_hold');
    expect(statusFromReview('init', null, 'applicantReset')).toBe('not_started');
    expect(statusFromReview('completed', { reviewAnswer: 'GREEN' }, 'applicantDeactivated')).toBe(
      'on_hold',
    );
  });

  it('ignores events that do not describe the applicant review', () => {
    // An action review (e.g. a payment method) must not approve the person.
    expect(
      statusFromReview('completed', { reviewAnswer: 'GREEN' }, 'applicantActionReviewed'),
    ).toBeNull();
    expect(statusFromReview(null, null, 'applicantTagsChanged')).toBeNull();
    // No review state says nothing, and must not demote an approval.
    expect(statusFromReview(null, null, 'applicantPersonalInfoChanged')).toBeNull();
  });
});

describe('parseSumsubEvent', () => {
  it('extracts the fields the database function needs', () => {
    const parsed = parseSumsubEvent(event());
    expect(parsed).toEqual({
      ok: true,
      event: {
        type: 'applicantReviewed',
        applicantId: '65f0c0ffee',
        profileId: PROFILE,
        reviewStatus: 'completed',
        reviewResult: { reviewAnswer: 'GREEN' },
        levelName: 'basic-kyc-level',
        correlationId: 'req-1',
        createdAt: new Date('2026-10-30T09:15:02.123Z'),
        status: 'approved',
      },
    });
  });

  it('falls back to createdAt when createdAtMs is absent', () => {
    const parsed = parseSumsubEvent(event({ createdAtMs: undefined }));
    expect(parsed.ok && parsed.event.createdAt.toISOString()).toBe('2026-10-30T09:15:02.000Z');
  });

  it('rejects payloads it cannot order or attribute', () => {
    expect(parseSumsubEvent('{not json')).toEqual({ ok: false, reason: 'invalid_json' });
    expect(parseSumsubEvent('[]')).toEqual({ ok: false, reason: 'invalid_json' });
    expect(parseSumsubEvent(event({ externalUserId: undefined }))).toEqual({
      ok: false,
      reason: 'missing_fields',
    });
    expect(parseSumsubEvent(event({ externalUserId: 'dashboard-applicant-7' }))).toEqual({
      ok: false,
      reason: 'invalid_profile',
    });
    expect(parseSumsubEvent(event({ createdAtMs: undefined, createdAt: undefined }))).toEqual({
      ok: false,
      reason: 'invalid_time',
    });
  });
});

describe('webhook signature', () => {
  const secret = 'whsec-test';
  const body = event();

  it('accepts Sumsub HMAC-SHA256 and SHA512 digests', async () => {
    const sha256 = createHmac('sha256', secret).update(body).digest('hex');
    const sha512 = createHmac('sha512', secret).update(body).digest('hex');
    await expect(signatureValid(secret, body, sha256, 'HMAC_SHA256_HEX')).resolves.toBe(true);
    await expect(signatureValid(secret, body, sha256.toUpperCase(), null)).resolves.toBe(true);
    await expect(signatureValid(secret, body, sha512, 'HMAC_SHA512_HEX')).resolves.toBe(true);
  });

  it('refuses a wrong secret, a tampered body, a missing digest and SHA-1', async () => {
    const digest = createHmac('sha256', secret).update(body).digest('hex');
    await expect(signatureValid('other', body, digest, 'HMAC_SHA256_HEX')).resolves.toBe(false);
    await expect(signatureValid(secret, `${body} `, digest, 'HMAC_SHA256_HEX')).resolves.toBe(
      false,
    );
    await expect(signatureValid(secret, body, null, 'HMAC_SHA256_HEX')).resolves.toBe(false);
    const sha1 = createHmac('sha1', secret).update(body).digest('hex');
    expect(digestAlgorithm('HMAC_SHA1_HEX')).toBeNull();
    await expect(signatureValid(secret, body, sha1, 'HMAC_SHA1_HEX')).resolves.toBe(false);
  });
});

describe('v1-sumsub-webhook handler', () => {
  const code = readFileSync(
    join(process.cwd(), 'supabase/functions/v1-sumsub-webhook/index.ts'),
    'utf8',
  );

  it('answers 503 with a log line, not a crash, when the secret is unset', () => {
    expect(code).not.toContain("Deno.env.get('SUMSUB_WEBHOOK_SECRET')!");
    expect(code).toMatch(
      /if \(!secret\) \{\s*\/\/[^\n]*\n\s*console\.error\([^)]*SUMSUB_WEBHOOK_SECRET[^)]*\);\s*return json\([^)]*503\);/,
    );
  });

  it('verifies the signature before parsing or writing anything', () => {
    const verify = code.indexOf('await signatureValid(');
    expect(verify).toBeGreaterThan(0);
    expect(verify).toBeLessThan(code.indexOf('parseSumsubEvent(body)'));
    expect(verify).toBeLessThan(code.indexOf('adminClient()'));
  });

  it('records and applies in one database call, keyed by the body digest', () => {
    expect(code).toContain("rpc('apply_sumsub_webhook_event'");
    expect(code).toContain('p_event_id: payloadSha256');
    // inspectionId is shared by every event of an applicant; it is not an event id.
    expect(code).not.toMatch(/payload\.inspectionId/);
    expect(code).not.toContain(".from('kyc_profiles')");
  });
});

describe('v1-sumsub-token', () => {
  const code = readFileSync(
    join(process.cwd(), 'supabase/functions/v1-sumsub-token/index.ts'),
    'utf8',
  );

  it('checks its secrets and surfaces the profile write error', () => {
    expect(code).not.toMatch(/Deno\.env\.get\('SUMSUB_[A-Z_]+'\)!/);
    expect(code).toMatch(/if \(!appToken \|\| !secret \|\| !levelName\)[\s\S]{0,300}503/);
    expect(code).toContain('if (insertError) throw insertError;');
    expect(code).toContain('if (restartError) throw restartError;');
  });

  it('never overwrites a decided status when the SDK is reopened', () => {
    expect(code).toContain("{ onConflict: 'profile_id', ignoreDuplicates: true }");
    expect(code).toContain(".eq('status', 'not_started')");
  });
});

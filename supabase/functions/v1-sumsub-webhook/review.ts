/**
 * Sumsub webhook parsing and verification, free of Deno and Supabase imports so
 * vitest can load it.
 */

export type KycStatus = 'not_started' | 'pending' | 'approved' | 'rejected' | 'on_hold';

export interface SumsubReviewEvent {
  type: string;
  applicantId: string;
  /** The `userId` sent when the access token was minted: our profile id. */
  profileId: string;
  reviewStatus: string | null;
  reviewResult: Record<string, unknown> | null;
  levelName: string | null;
  correlationId: string | null;
  /** When Sumsub created the event. Orders deliveries per applicant. */
  createdAt: Date;
  /** Null for event types that say nothing about the applicant's review. */
  status: KycStatus | null;
}

export type ParseResult =
  | { ok: true; event: SumsubReviewEvent }
  | { ok: false; reason: 'invalid_json' | 'missing_fields' | 'invalid_profile' | 'invalid_time' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sumsub timestamps are UTC strings without a `T`: `createdAtMs` is
 * `2024-03-11 13:31:46.468`, `createdAt` is `2024-03-11 13:31:46+0000`. Both
 * are accepted, as is ISO 8601. A value with no zone is UTC.
 */
export function parseSumsubTime(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  let text = value.trim().replace(' ', 'T');
  // +0000 -> +00:00, which Date parses everywhere.
  text = text.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(text)) text += 'Z';
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Applicant-level event types, the only ones whose review fields describe the
 * applicant. `applicantAction*` events review a separate action (a payment
 * method, say) and must not move the applicant's status; tag and other
 * housekeeping events carry nothing to apply.
 */
const APPLICANT_REVIEW_TYPES = new Set([
  'applicantCreated',
  'applicantPending',
  'applicantPrechecked',
  'applicantReviewed',
  'applicantOnHold',
  'applicantLevelChanged',
  'applicantWorkflowCompleted',
  'applicantPersonalInfoChanged',
  'applicantReset',
  'applicantDeleted',
  'applicantDeactivated',
  'applicantActivated',
]);

/**
 * The KYC status an event implies, or null when it implies none.
 *
 * Only a completed review approves. GREEN is approval; RED is a rejection
 * whether final or retryable (the reject type stays in `review_result`).
 * A reset or deleted applicant starts over; a deactivated one is held, never
 * left approved.
 */
export function statusFromReview(
  reviewStatus: string | null,
  reviewResult: Record<string, unknown> | null,
  type: string,
): KycStatus | null {
  if (!APPLICANT_REVIEW_TYPES.has(type)) return null;
  if (type === 'applicantReset' || type === 'applicantDeleted') return 'not_started';
  if (type === 'applicantDeactivated') return 'on_hold';
  if (reviewStatus === 'onHold' || type === 'applicantOnHold') return 'on_hold';
  // No review state at all says nothing; it must not demote an approval.
  if (!reviewStatus) return null;
  if (reviewStatus === 'completed') {
    return reviewResult?.reviewAnswer === 'GREEN' ? 'approved' : 'rejected';
  }
  return 'pending';
}

export function parseSumsubEvent(body: string): ParseResult {
  let payload: Record<string, unknown>;
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, reason: 'invalid_json' };
    }
    payload = value as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  const type = typeof payload.type === 'string' ? payload.type : '';
  const applicantId = typeof payload.applicantId === 'string' ? payload.applicantId : '';
  const externalUserId = typeof payload.externalUserId === 'string' ? payload.externalUserId : '';
  if (!type || !applicantId || !externalUserId) return { ok: false, reason: 'missing_fields' };
  // Applicants created by hand in the Sumsub dashboard carry no profile id.
  if (!UUID.test(externalUserId)) return { ok: false, reason: 'invalid_profile' };

  const createdAt = parseSumsubTime(payload.createdAtMs) ?? parseSumsubTime(payload.createdAt);
  if (!createdAt) return { ok: false, reason: 'invalid_time' };

  const reviewStatus = typeof payload.reviewStatus === 'string' ? payload.reviewStatus : null;
  const reviewResult =
    payload.reviewResult && typeof payload.reviewResult === 'object'
      ? (payload.reviewResult as Record<string, unknown>)
      : null;

  return {
    ok: true,
    event: {
      type,
      applicantId,
      profileId: externalUserId.toLowerCase(),
      reviewStatus,
      reviewResult,
      levelName: typeof payload.levelName === 'string' ? payload.levelName : null,
      correlationId: typeof payload.correlationId === 'string' ? payload.correlationId : null,
      createdAt,
      status: statusFromReview(reviewStatus, reviewResult, type),
    },
  };
}

/**
 * The HMAC algorithm named by `X-Payload-Digest-Alg`.
 *
 * SHA-1 is refused rather than silently checked as SHA-256 (which is what the
 * previous code did, failing every delivery with a 401 that looked like a bad
 * secret). Set the webhook to HMAC_SHA256_HEX in the Sumsub dashboard.
 */
export function digestAlgorithm(header: string | null): 'SHA-256' | 'SHA-512' | null {
  const value = (header ?? 'HMAC_SHA256_HEX').trim().toUpperCase();
  if (value === 'HMAC_SHA256_HEX') return 'SHA-256';
  if (value === 'HMAC_SHA512_HEX') return 'SHA-512';
  return null;
}

export async function hmacHex(
  secret: string,
  body: string,
  hash: 'SHA-256' | 'SHA-512',
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash },
    false,
    ['sign'],
  );
  const value = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two hex strings. */
export function equalHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function signatureValid(
  secret: string,
  body: string,
  supplied: string | null,
  algorithmHeader: string | null,
): Promise<boolean> {
  const hash = digestAlgorithm(algorithmHeader);
  if (!hash || !supplied) return false;
  return equalHex(supplied.trim().toLowerCase(), await hmacHex(secret, body, hash));
}

import { supabase } from '@/providers/supabase';
import { recordDiagnostic } from '@/lib/diagnostics';

/**
 * Calls an Edge Function and surfaces the error the function actually returned.
 *
 * `functions.invoke` reports every non-2xx as a `FunctionsHttpError` whose
 * message is the fixed string "Edge Function returned a non-2xx status code",
 * sets `data` to null, and leaves the response body unread on `error.context`.
 * Reading `data.error` therefore only works when a function fails with a 200,
 * which none of ours do — so a caller that trusts it replaces every explanation
 * the server produced with a generic sentence.
 */

export function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

export const EDGE_FUNCTION_DEADLINE_MS = 45_000;

/**
 * The request may have reached the function even though the browser stopped
 * waiting. Mutation callers must reconcile by idempotency key/hash before they
 * offer another submit; this error intentionally distinguishes that state from
 * a definite server rejection.
 */
export class EdgeFunctionOutcomeUnknownError extends Error {
  readonly outcomeUnknown = true;

  constructor(readonly functionName: string) {
    super(
      `Could not reach the server (${functionName}) before the request ended. Its result may be pending; do not submit the same mutation again until it is reconciled.`,
    );
    this.name = 'EdgeFunctionOutcomeUnknownError';
  }
}

/** Pulls `{ error }` out of an unread error response body, if there is one. */
async function bodyMessage(error: unknown): Promise<string | undefined> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!context || typeof context !== 'object') return undefined;
  const response = context as Response;
  if (typeof response.clone !== 'function' || typeof response.text !== 'function') {
    return undefined;
  }
  try {
    // Cloned so a caller that wants the raw response is not left with a used body.
    const text = await response.clone().text();
    if (!text) return undefined;
    const parsed = JSON.parse(text) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : undefined;
  } catch {
    // Not JSON, or already consumed. Fall back to the generic message.
    return undefined;
  }
}

export async function invokeEdgeFunction<T>(
  name: string,
  body: Record<string, unknown> = {},
  deadlineMs = EDGE_FUNCTION_DEADLINE_MS,
): Promise<T> {
  const { data, error } = await requireClient().functions.invoke(name, {
    body,
    // Supabase forwards this to an AbortController around the complete fetch,
    // including response-body parsing. A Promise.race would merely stop the UI
    // waiting while leaving the network operation alive.
    timeout: deadlineMs,
  });
  const inlineError = (data as { error?: unknown } | null)?.error;

  if (!error && !inlineError) return data as T;

  const transport = error instanceof Error ? error.message : undefined;
  /*
   * `FunctionsFetchError` means the request never reached the server — a dropped
   * mobile connection, a captive portal, a cold start that timed out. Its own
   * message ("Failed to send a request to the Edge Function") reads like a bug
   * in the app, so it is replaced with something the user can act on.
   */
  const networkFailure = transport?.includes('Failed to send a request');
  const aborted =
    transport?.includes('aborted') ||
    transport?.includes('timeout') ||
    (error as { context?: { name?: unknown } } | null)?.context?.name === 'AbortError';

  if (aborted || networkFailure) {
    recordDiagnostic('server', `${name} outcome unknown`, { aborted: Boolean(aborted) });
    throw new EdgeFunctionOutcomeUnknownError(name);
  }

  const message =
    (typeof inlineError === 'string' ? inlineError : undefined) ??
    (await bodyMessage(error)) ??
    transport ??
    `${name} failed`;
  const status = (error as { context?: { status?: unknown } } | null)?.context?.status;
  recordDiagnostic('server', `${name}: ${message}`, {
    status: typeof status === 'number' ? status : null,
  });
  throw new Error(message);
}

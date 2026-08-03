import { supabase } from '@/providers/supabase';

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
): Promise<T> {
  const { data, error } = await requireClient().functions.invoke(name, { body });
  const inlineError = (data as { error?: unknown } | null)?.error;

  if (!error && !inlineError) return data as T;

  const message =
    (typeof inlineError === 'string' ? inlineError : undefined) ??
    (await bodyMessage(error)) ??
    (error instanceof Error ? error.message : undefined) ??
    `${name} failed`;
  throw new Error(message);
}

interface FunctionErrorWithContext {
  message?: string;
  context?: Response;
}

/**
 * The JSON an edge function returned, whichever way the SDK surfaced it.
 *
 * `functions.invoke` resolves with `{ data, error }`, and on any non-2xx it sets
 * `data` to null and hands the whole response over as `error.context`. So a
 * function that answers 409 with a body describing what to do next has that body
 * reachable only through the error — reading it from `data` finds nothing.
 *
 * That is not a detail: the relink flow returned `requiresConfirmation` on a 409
 * and the client read it from `data`, so the confirmation prompt never appeared
 * and a wallet could not be relinked at all. Only the message was being rescued
 * from the error, which made the failure look like a plain refusal rather than a
 * question nobody was asked.
 */
export async function functionResponseBody(
  error: unknown,
  data: unknown,
): Promise<Record<string, unknown> | undefined> {
  if (data && typeof data === 'object') return data as Record<string, unknown>;

  const functionError = error as FunctionErrorWithContext | null;
  if (functionError?.context instanceof Response) {
    try {
      // Cloned because the caller may read the same response again.
      return (await functionError.context.clone().json()) as Record<string, unknown>;
    } catch {
      // Not JSON. The SDK's own message is the best that remains.
    }
  }
  return undefined;
}

export async function functionErrorMessage(
  error: unknown,
  data: unknown,
  fallback: string,
): Promise<string> {
  const body = await functionResponseBody(error, data);
  if (typeof body?.error === 'string' && body.error.length > 0) return body.error;

  return (error as FunctionErrorWithContext | null)?.message || fallback;
}

/** A read-only transaction check exceeded its deadline; nothing was sent. */
export class PreflightTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightTimeoutError';
  }
}

/**
 * Bounds work performed before a wallet request exists.
 *
 * Rejecting here is safe to retry: these tasks only read auth or chain state.
 * The original promise may eventually settle, but no continuation runs after
 * this wrapper rejects and no transaction has been broadcast.
 */
export async function withPreflightTimeout<T>(
  task: PromiseLike<T>,
  message: string,
  timeoutMs = 20_000,
): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new PreflightTimeoutError(message)), timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(task), timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

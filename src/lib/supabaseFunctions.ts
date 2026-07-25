interface FunctionErrorWithContext {
  message?: string;
  context?: Response;
}

export async function functionErrorMessage(
  error: unknown,
  data: unknown,
  fallback: string,
): Promise<string> {
  if (data && typeof data === 'object' && 'error' in data) {
    const message = (data as { error?: unknown }).error;
    if (typeof message === 'string' && message.length > 0) return message;
  }

  const functionError = error as FunctionErrorWithContext | null;
  if (functionError?.context instanceof Response) {
    try {
      const body = (await functionError.context.clone().json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error.length > 0) return body.error;
    } catch {
      // Fall through to the SDK message when the response is not JSON.
    }
  }

  return functionError?.message || fallback;
}

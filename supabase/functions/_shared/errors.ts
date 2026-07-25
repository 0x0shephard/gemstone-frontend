export function safeErrorMessage(error: unknown, fallback: string): string {
  const shortMessage =
    error &&
    typeof error === 'object' &&
    'shortMessage' in error &&
    typeof error.shortMessage === 'string'
      ? error.shortMessage
      : error instanceof Error
        ? error.message
        : fallback;
  const details =
    error &&
    typeof error === 'object' &&
    'details' in error &&
    typeof error.details === 'string' &&
    error.details !== shortMessage
      ? error.details
      : '';
  const candidate = details ? `${shortMessage} — ${details}` : shortMessage;
  return (
    candidate
      .split('\n')[0]
      .replace(/https?:\/\/\S+/gi, '[RPC endpoint]')
      .trim()
      .slice(0, 500) || fallback
  );
}

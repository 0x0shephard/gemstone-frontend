export function safeErrorMessage(error: unknown, fallback: string): string {
  const candidate =
    error &&
    typeof error === 'object' &&
    'shortMessage' in error &&
    typeof error.shortMessage === 'string'
      ? error.shortMessage
      : error instanceof Error
        ? error.message
        : fallback;
  return (
    candidate
      .split('\n')[0]
      .replace(/https?:\/\/\S+/gi, '[RPC endpoint]')
      .trim()
      .slice(0, 500) || fallback
  );
}

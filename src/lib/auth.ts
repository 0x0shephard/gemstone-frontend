export type AuthActionResult = { ok: boolean; message: string };

export function friendlyAuthError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Authentication could not be started.';

  if (/unsupported provider|provider is not enabled/i.test(message)) {
    return 'Google sign-in is not enabled for this Supabase project. Enable the Google provider or use an email link.';
  }
  if (/redirect|not allowed/i.test(message)) {
    return 'This site is not in the allowed Supabase redirect URLs. Update Auth URL Configuration and try again.';
  }
  return message;
}

export function oauthRedirectError(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const description = params.get('error_description');
  return description ? friendlyAuthError(description) : null;
}

import { describe, expect, it } from 'vitest';
import { friendlyAuthError, oauthRedirectError } from './auth';

describe('authentication errors', () => {
  it('turns a disabled Google provider response into actionable guidance', () => {
    expect(friendlyAuthError('Unsupported provider: provider is not enabled')).toContain(
      'Google sign-in is not enabled',
    );
  });

  it('reads OAuth failures returned in a URL hash', () => {
    expect(
      oauthRedirectError(
        '#error=server_error&error_description=redirect+URL+is+not+allowed&error_code=400',
      ),
    ).toContain('allowed Supabase redirect URLs');
  });
});

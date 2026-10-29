import { EdgeFunctionError, invokeEdgeFunction } from './invoke';

/**
 * What the Sumsub WebSDK needs to open: a token, and a way to get the next one.
 *
 * The same shape as `beginKyc()` in `workflows.ts` from the auth/KYC backend
 * change (#13). It lives here, as a thin call to `v1-sumsub-token`, so this UI
 * does not depend on that change landing first; once it has, this can simply
 * delegate to `beginKyc`.
 */
export interface KycSession {
  accessToken: string;
  /** When `accessToken` stops working, in ms since the epoch. */
  expiresAt: number;
  /** The WebSDK's `expirationHandler`: resolves to a fresh token for the same applicant. */
  refreshToken: () => Promise<string>;
}

export const KYC_UNAVAILABLE_MESSAGE = 'Identity verification is not available yet.';

async function issueToken(): Promise<{ token: string; expiresIn: number }> {
  try {
    const result = await invokeEdgeFunction<{ token?: unknown; expiresIn?: unknown }>(
      'v1-sumsub-token',
    );
    if (!result || typeof result.token !== 'string' || !result.token) {
      throw new Error('Identity verification could not be started. Try again.');
    }
    return {
      token: result.token,
      expiresIn: typeof result.expiresIn === 'number' ? result.expiresIn : 600,
    };
  } catch (error) {
    /*
     * 503 is the endpoint saying the provider is not configured for this
     * deployment, and 404 is a deployment without the function at all. Neither
     * is the user's fault or worth retrying, so both read the same way.
     */
    if (error instanceof EdgeFunctionError && (error.status === 503 || error.status === 404)) {
      throw new Error(KYC_UNAVAILABLE_MESSAGE, { cause: error });
    }
    throw error;
  }
}

/** Starts (or resumes) identity verification for the signed-in user. */
export async function startKycSession(): Promise<KycSession> {
  const first = await issueToken();
  return {
    accessToken: first.token,
    expiresAt: Date.now() + first.expiresIn * 1_000,
    refreshToken: async () => (await issueToken()).token,
  };
}

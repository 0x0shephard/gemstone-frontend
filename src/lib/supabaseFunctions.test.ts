import { describe, expect, it } from 'vitest';
import { functionErrorMessage, functionResponseBody } from './supabaseFunctions';

/**
 * `functions.invoke` resolves `{ data, error }`, and on any non-2xx it sets
 * `data` to null and hands the whole response over as `error.context`. A
 * function that answers 409 with instructions therefore has them reachable only
 * through the error.
 *
 * The bug these cover: the relink flow returned `requiresConfirmation` on a 409
 * and the client read it from `data`, where it was always undefined. The prompt
 * never appeared, the refusal read as final, and a wallet could not be relinked
 * at all.
 */
const httpError = (status: number, body: unknown) => ({
  message: `Edge Function returned a non-2xx status code: ${status}`,
  context: new Response(JSON.stringify(body), { status }),
});

describe('reading an edge function response', () => {
  it('finds the body of a non-2xx, where the SDK hides it', async () => {
    const error = httpError(409, {
      error: 'Explicit relink confirmation required',
      requiresConfirmation: true,
    });
    const body = await functionResponseBody(error, null);
    expect(body?.requiresConfirmation).toBe(true);
    expect(body?.error).toBe('Explicit relink confirmation required');
  });

  it('prefers data when the call actually succeeded', async () => {
    expect(await functionResponseBody(null, { wallet_address: '0xabc' })).toEqual({
      wallet_address: '0xabc',
    });
  });

  it('returns nothing when the response is not JSON', async () => {
    const error = { message: 'boom', context: new Response('gateway timeout', { status: 504 }) };
    expect(await functionResponseBody(error, null)).toBeUndefined();
  });

  it('leaves the response readable for the next reader', async () => {
    // Both helpers are called on the same error in `linkWallet`, so consuming
    // the body once must not starve the second call.
    const error = httpError(409, { error: 'Explicit relink confirmation required' });
    expect((await functionResponseBody(error, null))?.error).toBe(
      'Explicit relink confirmation required',
    );
    expect(await functionErrorMessage(error, null, 'fallback')).toBe(
      'Explicit relink confirmation required',
    );
  });
});

describe('choosing what to tell the reader', () => {
  it('uses the function’s own message over the SDK’s', async () => {
    const error = httpError(400, { error: 'That gift card is not yours to send' });
    expect(await functionErrorMessage(error, null, 'fallback')).toBe(
      'That gift card is not yours to send',
    );
  });

  it('falls back to the SDK message when there is no body', async () => {
    expect(await functionErrorMessage({ message: 'Failed to fetch' }, null, 'fallback')).toBe(
      'Failed to fetch',
    );
  });

  it('falls back to the caller’s wording when there is nothing at all', async () => {
    expect(await functionErrorMessage(null, null, 'Wallet verification failed.')).toBe(
      'Wallet verification failed.',
    );
  });
});

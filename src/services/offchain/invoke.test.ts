import { describe, expect, it, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@/providers/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

const { invokeEdgeFunction } = await import('./invoke');

/**
 * `functions.invoke` reports every non-2xx as this fixed message, nulls `data`,
 * and leaves the body unread on `context`. Reproduced exactly, because trusting
 * `data.error` instead is what replaced every server explanation with the
 * generic sentence.
 */
function httpError(body: unknown, status = 409) {
  const error = new Error('Edge Function returned a non-2xx status code');
  (error as Error & { context: Response }).context = new Response(JSON.stringify(body), { status });
  return { data: null, error };
}

describe('invokeEdgeFunction', () => {
  beforeEach(() => invokeMock.mockReset());

  it('returns the payload on success', async () => {
    invokeMock.mockResolvedValue({ data: { status: 'awaiting_grading' }, error: null });
    await expect(invokeEdgeFunction('v1-seller-submit')).resolves.toEqual({
      status: 'awaiting_grading',
    });
  });

  it('surfaces the message the function actually returned', async () => {
    invokeMock.mockResolvedValue(httpError({ error: 'A verified primary wallet is required' }));
    await expect(invokeEdgeFunction('v1-seller-activate')).rejects.toThrow(
      'A verified primary wallet is required',
    );
  });

  it('does not leak the generic supabase message when a body message exists', async () => {
    invokeMock.mockResolvedValue(httpError({ error: 'Image CID confirmed by 0 of 2 gateways' }));
    await expect(invokeEdgeFunction('v1-seller-activate')).rejects.toThrow(/Image CID/);
  });

  it('falls back to the transport message when the body is not JSON', async () => {
    const error = new Error('Edge Function returned a non-2xx status code');
    (error as Error & { context: Response }).context = new Response('<html>502</html>', {
      status: 502,
    });
    invokeMock.mockResolvedValue({ data: null, error });
    await expect(invokeEdgeFunction('v1-verification-queue')).rejects.toThrow(/non-2xx/);
  });

  it('still honours an error returned with a 200', async () => {
    invokeMock.mockResolvedValue({ data: { error: 'Not found' }, error: null });
    await expect(invokeEdgeFunction('v1-verification-queue')).rejects.toThrow('Not found');
  });

  it('leaves the response body readable for the caller', async () => {
    const result = httpError({ error: 'Daily valuation limit reached' }, 429);
    invokeMock.mockResolvedValue(result);
    await expect(invokeEdgeFunction('v1-verification-grade')).rejects.toThrow(/Daily valuation/);
    // Cloned rather than consumed, so the original Response is still usable.
    await expect(
      (result.error as Error & { context: Response }).context.json(),
    ).resolves.toMatchObject({ error: 'Daily valuation limit reached' });
  });
});

describe('network failures', () => {
  beforeEach(() => invokeMock.mockReset());

  it('replaces the SDK transport message with something actionable', async () => {
    // FunctionsFetchError: the request never reached the server. Its own wording
    // reads like an application bug rather than a connectivity problem.
    invokeMock.mockResolvedValue({
      data: null,
      error: new Error('Failed to send a request to the Edge Function'),
    });
    await expect(invokeEdgeFunction('v1-custody-confirm')).rejects.toThrow(
      /could not reach the server/i,
    );
  });

  it('still prefers a real server message when there is one', async () => {
    invokeMock.mockResolvedValue(
      httpError({ error: 'This submission is not awaiting custody intake' }),
    );
    await expect(invokeEdgeFunction('v1-custody-confirm')).rejects.toThrow(/awaiting custody/i);
  });
});

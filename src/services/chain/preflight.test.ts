import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreflightTimeoutError, withPreflightTimeout } from './preflight';

describe('transaction preflight deadline', () => {
  afterEach(() => vi.useRealTimers());

  it('returns a completed read', async () => {
    await expect(withPreflightTimeout(Promise.resolve('ready'), 'timed out', 10)).resolves.toBe(
      'ready',
    );
  });

  it('ends a stalled read with a retry-safe explanation', async () => {
    vi.useFakeTimers();
    const result = withPreflightTimeout(new Promise<never>(() => {}), 'RPC did not respond.', 20);
    const rejection = expect(result).rejects.toEqual(
      new PreflightTimeoutError('RPC did not respond.'),
    );

    await vi.advanceTimersByTimeAsync(20);

    await rejection;
  });
});

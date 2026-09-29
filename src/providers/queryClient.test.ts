import { describe, expect, it, vi } from 'vitest';
import { queryClient, refreshChainQueries } from './queryClient';

describe('chain query refresh coordination', () => {
  it('coalesces an active refresh and queues one follow-up for a newer snapshot', async () => {
    let finishFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockReturnValueOnce(first)
      .mockResolvedValue(undefined);

    const running = refreshChainQueries();
    expect(refreshChainQueries()).toBe(running);
    expect(refreshChainQueries()).toBe(running);
    expect(invalidate).toHaveBeenCalledTimes(1);

    finishFirst();
    await running;
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(invalidate.mock.calls[0]?.[0]).toMatchObject({ refetchType: 'active' });
    invalidate.mockRestore();
  });
});

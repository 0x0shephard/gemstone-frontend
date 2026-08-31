import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('@/providers/supabase', () => ({
  supabase: { from: supabaseMock.from },
}));

import { clearAllNotifications, listNotifications, markNotificationRead } from './notifications';

describe('notification persistence', () => {
  beforeEach(() => {
    supabaseMock.from.mockReset();
  });

  it('decodes rows returned by the signed-in notification feed', async () => {
    const row = {
      id: 'notice-1',
      kind: 'swap.received',
      title: 'Swap received',
      body: 'A collector wants to trade.',
      action_path: '/swaps',
      entity_type: 'swap',
      entity_id: '7',
      expires_at: null,
      read_at: null,
      created_at: '2026-08-31T00:00:00.000Z',
    };
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    query.select = vi.fn(() => query);
    query.is = vi.fn(() => query);
    query.order = vi.fn(() => query);
    query.limit = vi.fn().mockResolvedValue({ data: [row], error: null });
    supabaseMock.from.mockReturnValue(query);

    await expect(listNotifications()).resolves.toEqual([
      {
        id: 'notice-1',
        kind: 'swap.received',
        title: 'Swap received',
        body: 'A collector wants to trade.',
        actionPath: '/swaps',
        entityType: 'swap',
        entityId: '7',
        expiresAt: null,
        readAt: null,
        createdAt: '2026-08-31T00:00:00.000Z',
      },
    ]);
  });

  it('does not turn a backend failure into an empty inbox', async () => {
    const failure = new Error('database unavailable');
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    query.select = vi.fn(() => query);
    query.is = vi.fn(() => query);
    query.order = vi.fn(() => query);
    query.limit = vi.fn().mockResolvedValue({ data: null, error: failure });
    supabaseMock.from.mockReturnValue(query);

    await expect(listNotifications()).rejects.toBe(failure);
  });

  it('propagates failed read and dismissal writes', async () => {
    const readFailure = new Error('read update failed');
    supabaseMock.from.mockReturnValueOnce({
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: readFailure }),
      })),
    });
    await expect(markNotificationRead('notice-1')).rejects.toBe(readFailure);

    const clearFailure = new Error('dismissal update failed');
    supabaseMock.from.mockReturnValueOnce({
      update: vi.fn(() => ({
        is: vi.fn().mockResolvedValue({ error: clearFailure }),
      })),
    });
    await expect(clearAllNotifications()).rejects.toBe(clearFailure);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const notificationMock = vi.hoisted(() => ({
  clearAll: vi.fn(),
  dismiss: vi.fn(),
  list: vi.fn(),
  readAll: vi.fn(),
  readOne: vi.fn(),
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'profile-1' } }),
}));

vi.mock('@/services/offchain/notifications', () => ({
  clearAllNotifications: notificationMock.clearAll,
  dismissNotification: notificationMock.dismiss,
  listNotifications: notificationMock.list,
  markAllNotificationsRead: notificationMock.readAll,
  markNotificationRead: notificationMock.readOne,
}));

vi.mock('./PushToggle', () => ({ PushToggle: () => null }));

import { NotificationBell } from './NotificationBell';

function renderBell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <NotificationBell />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('NotificationBell', () => {
  beforeEach(() => {
    for (const mock of Object.values(notificationMock)) mock.mockReset();
    notificationMock.clearAll.mockResolvedValue(undefined);
    notificationMock.dismiss.mockResolvedValue(undefined);
    notificationMock.readAll.mockResolvedValue(undefined);
    notificationMock.readOne.mockResolvedValue(undefined);
  });

  it('shows a retryable error instead of claiming a failed inbox is empty', async () => {
    notificationMock.list.mockRejectedValue(new Error('database unavailable'));
    renderBell();

    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Notifications could not be loaded');
    expect(screen.queryByText('Nothing needs your attention.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders the empty state only after a successful read', async () => {
    notificationMock.list.mockResolvedValue([]);
    renderBell();

    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));

    expect(await screen.findByText('Nothing needs your attention.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.hoisted(() => ({
  disable: vi.fn(),
  enable: vi.fn(),
  needsInstall: vi.fn(),
  state: vi.fn(),
  supported: vi.fn(),
}));

vi.mock('@/services/offchain/push', () => ({
  disablePush: pushMock.disable,
  enablePush: pushMock.enable,
  needsHomeScreenInstall: pushMock.needsInstall,
  pushState: pushMock.state,
  pushSupported: pushMock.supported,
}));

import { PushToggle } from './PushToggle';

describe('PushToggle', () => {
  beforeEach(() => {
    pushMock.disable.mockReset();
    pushMock.enable.mockReset();
    pushMock.needsInstall.mockReset().mockReturnValue(false);
    pushMock.state.mockReset().mockResolvedValue('unsubscribed');
    pushMock.supported.mockReset().mockReturnValue(true);
  });

  it('explains the Home Screen requirement instead of disappearing on iOS', async () => {
    pushMock.needsInstall.mockReturnValue(true);
    pushMock.supported.mockReturnValue(false);
    pushMock.state.mockResolvedValue('unsupported');

    render(<PushToggle />);

    expect(await screen.findByText(/add to home screen/i)).toBeInTheDocument();
    expect(screen.getByText(/open safari’s share menu/i)).toBeInTheDocument();
  });

  it('subscribes from the button gesture on a supported browser', async () => {
    pushMock.enable.mockResolvedValue('subscribed');
    render(<PushToggle />);

    const button = await screen.findByRole('button', { name: 'Turn on' });
    await userEvent.click(button);

    expect(pushMock.enable).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: 'Turn off' })).toBeInTheDocument();
  });

  it('shows a service-worker check failure and keeps a retry control visible', async () => {
    pushMock.state.mockRejectedValue(new Error('Service worker unavailable'));
    render(<PushToggle />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Service worker unavailable');
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });
});

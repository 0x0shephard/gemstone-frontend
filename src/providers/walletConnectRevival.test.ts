import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from 'wagmi';
import { reviveWalletConnectOnReturn } from './walletConnectRevival';

afterEach(() => {
  vi.restoreAllMocks();
});

function configWithRelayer(restartTransport: () => Promise<void>, connected = true): Config {
  return {
    state: { connections: new Map(), current: null, status: 'disconnected' },
    connectors: [
      {
        id: 'walletConnect',
        type: 'walletConnect',
        isAuthorized: async () => false,
        getProvider: async () => ({
          signer: { client: { core: { relayer: { connected, restartTransport } } } },
        }),
      },
    ],
  } as unknown as Config;
}

describe('WalletConnect revival', () => {
  it('restarts a transport immediately in case the return event happened before mount', async () => {
    const restart = vi.fn(async () => {});
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const cleanup = reviveWalletConnectOnReturn(configWithRelayer(restart, true), {
      retryDelaysMs: [0],
    });

    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    cleanup();
  });

  it('also wakes on focus and removes every listener during cleanup', async () => {
    const restart = vi.fn(async () => {});
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const cleanup = reviveWalletConnectOnReturn(configWithRelayer(restart), {
      retryDelaysMs: [0],
    });

    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(2));
    cleanup();
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(restart).toHaveBeenCalledTimes(2);
  });

  it('revives a branded WalletConnect connector by its connector type', async () => {
    const restart = vi.fn(async () => {});
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const config = {
      state: { connections: new Map(), current: null, status: 'disconnected' },
      connectors: [
        {
          id: 'metaMaskWalletConnect',
          type: 'walletConnect',
          isAuthorized: async () => false,
          getProvider: async () => ({
            signer: { client: { core: { relayer: { restartTransport: restart } } } },
          }),
        },
      ],
    } as unknown as Config;
    const cleanup = reviveWalletConnectOnReturn(config, { retryDelaysMs: [0] });

    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    cleanup();
  });

  it('registers an approved session with wagmi when the original connect promise was lost', async () => {
    const restart = vi.fn(async () => {});
    const reconnectAction = vi.fn(async (config: Config) => {
      config.state.current = 'walletconnect-uid';
      config.state.status = 'connected';
    });
    const config = configWithRelayer(restart);
    config.connectors[0].isAuthorized = async () => true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });

    const cleanup = reviveWalletConnectOnReturn(config, {
      reconnectAction,
      retryDelaysMs: [0],
    });

    await vi.waitFor(() => expect(reconnectAction).toHaveBeenCalledTimes(1));
    expect(reconnectAction).toHaveBeenCalledWith(config, {
      connectors: [config.connectors[0]],
    });
    cleanup();
  });

  it('restores MetaMask Connect after the browser loses the original connect task', async () => {
    const reconnectAction = vi.fn(async (config: Config) => {
      config.state.current = 'metamask-connect-uid';
      config.state.status = 'connected';
    });
    const connector = {
      id: 'metaMaskConnect',
      type: 'metaMask',
      isAuthorized: vi.fn(async () => true),
      getProvider: vi.fn(async () => ({})),
    };
    const config = {
      state: { connections: new Map(), current: null, status: 'disconnected' },
      connectors: [connector],
    } as unknown as Config;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });

    const cleanup = reviveWalletConnectOnReturn(config, {
      reconnectAction,
      retryDelaysMs: [0],
    });

    await vi.waitFor(() => expect(reconnectAction).toHaveBeenCalledTimes(1));
    expect(reconnectAction).toHaveBeenCalledWith(config, {
      connectors: [config.connectors[0]],
    });
    cleanup();
  });

  it('waits for relay delivery before recovering a newly authorised session', async () => {
    const restart = vi.fn(async () => {});
    const reconnectAction = vi.fn(async () => {});
    const config = configWithRelayer(restart);
    const isAuthorized = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    config.connectors[0].isAuthorized = isAuthorized;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });

    const cleanup = reviveWalletConnectOnReturn(config, {
      reconnectAction,
      retryDelaysMs: [0, 1],
    });

    await vi.waitFor(() => expect(reconnectAction).toHaveBeenCalledTimes(1));
    expect(isAuthorized).toHaveBeenCalledTimes(2);
    cleanup();
  });
});

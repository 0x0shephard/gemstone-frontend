import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from 'wagmi';
import { reviveWalletConnectOnReturn } from './walletConnectRevival';

afterEach(() => {
  vi.restoreAllMocks();
});

function configWithRelayer(restartTransport: () => Promise<void>, connected = true): Config {
  return {
    state: { connections: new Map(), current: null },
    connectors: [
      {
        id: 'walletConnect',
        type: 'walletConnect',
        getProvider: async () => ({
          signer: { client: { core: { relayer: { connected, restartTransport } } } },
        }),
      },
    ],
  } as unknown as Config;
}

describe('WalletConnect revival', () => {
  it('restarts a transport that still claims to be connected after an app switch', async () => {
    const restart = vi.fn(async () => {});
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const cleanup = reviveWalletConnectOnReturn(configWithRelayer(restart, true));

    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    cleanup();
  });

  it('also wakes on focus and removes every listener during cleanup', async () => {
    const restart = vi.fn(async () => {});
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const cleanup = reviveWalletConnectOnReturn(configWithRelayer(restart));

    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    cleanup();
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('revives a branded WalletConnect connector by its connector type', async () => {
    const restart = vi.fn(async () => {});
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const config = {
      state: { connections: new Map(), current: null },
      connectors: [
        {
          id: 'metaMaskWalletConnect',
          type: 'walletConnect',
          getProvider: async () => ({
            signer: { client: { core: { relayer: { restartTransport: restart } } } },
          }),
        },
      ],
    } as unknown as Config;
    const cleanup = reviveWalletConnectOnReturn(config);

    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    cleanup();
  });
});

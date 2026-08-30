import { describe, expect, it, vi } from 'vitest';
import type { CreateConnectorFn } from 'wagmi';
import { connectWithoutChainSwitch, metaMaskMobileUri } from './mobileMetaMaskWallet';

describe('mobile MetaMask WalletConnect', () => {
  const pairingUri =
    'wc:abc123@2?relay-protocol=irn&symKey=0123456789abcdef&expiryTimestamp=1780000000';

  it.each([
    [
      'Android Chrome',
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36',
    ],
    ['Android Firefox', 'Mozilla/5.0 (Android 15; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0'],
    [
      'Samsung Internet',
      'Mozilla/5.0 (Linux; Android 15; SAMSUNG SM-S938B) AppleWebKit/537.36 SamsungBrowser/28.0 Chrome/130.0 Mobile Safari/537.36',
    ],
  ])('uses the tab-preserving MetaMask scheme in %s', (_browser, userAgent) => {
    expect(metaMaskMobileUri(pairingUri, { userAgent })).toBe(
      `metamask://wc?uri=${encodeURIComponent(pairingUri)}`,
    );
  });

  it('still recognises Android when Chrome requests a desktop user agent', () => {
    expect(
      metaMaskMobileUri(pairingUri, {
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
        userAgentData: { platform: 'Android' },
      }),
    ).toBe(`metamask://wc?uri=${encodeURIComponent(pairingUri)}`);
  });

  it.each([
    [
      'iPhone Safari',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
    ],
    [
      'iPhone Chrome',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1',
    ],
  ])("uses MetaMask's iOS universal link in %s", (_browser, userAgent) => {
    expect(metaMaskMobileUri(pairingUri, { userAgent })).toBe(
      `https://metamask.app.link/wc?uri=${encodeURIComponent(pairingUri)}`,
    );
  });

  it('keeps the universal link as a safe fallback when no browser exists', () => {
    expect(metaMaskMobileUri(pairingUri, undefined)).toBe(
      `https://metamask.app.link/wc?uri=${encodeURIComponent(pairingUri)}`,
    );
  });

  it('finishes pairing without issuing a second global-chain switch', async () => {
    const connect = vi.fn(async (parameters?: Record<string, unknown>) => ({
      accounts: ['0x0000000000000000000000000000000000000001'],
      chainId: 1,
      parameters,
    }));
    const base = (() => ({
      id: 'walletConnect',
      name: 'WalletConnect',
      type: 'walletConnect',
      connect,
    })) as unknown as CreateConnectorFn;
    const connector = connectWithoutChainSwitch(base)({} as never);

    await connector.connect({ chainId: 11155111, isReconnecting: false });

    expect(connect).toHaveBeenCalledWith({ isReconnecting: false });
  });
});

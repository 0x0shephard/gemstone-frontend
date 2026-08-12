import { describe, expect, it } from 'vitest';
import { selectWallets, walletSupportIsDegraded } from './walletSelection';

const kinds = (environment: Parameters<typeof selectWallets>[0]) =>
  selectWallets(environment).flatMap((group) => group.kinds);

describe('wallet selection', () => {
  /**
   * The regression this file exists for. A phone has no injected provider, so a
   * list containing only `injected` offers one option that can never work — and
   * the visitor cannot connect at all, with nothing on screen suggesting why.
   */
  it('always offers a phone something it can actually use', () => {
    for (const walletConnect of [true, false]) {
      const offered = kinds({ walletConnect, hasInjected: false, touchPrimary: true });
      expect(offered.length).toBeGreaterThan(0);
      expect(offered).not.toEqual(['injected']);
      // Coinbase deep-links through its own SDK, so it works with no Reown id.
      expect(offered).toContain('coinbase');
    }
  });

  it('does not offer a browser wallet on a phone that has none', () => {
    expect(kinds({ walletConnect: true, hasInjected: false, touchPrimary: true })).not.toContain(
      'injected',
    );
  });

  it('offers the in-app browser wallet when a phone does have one', () => {
    // MetaMask's in-app browser injects a provider; that is a real option.
    expect(kinds({ walletConnect: false, hasInjected: true, touchPrimary: true })).toContain(
      'injected',
    );
  });

  it('keeps the injected option on desktop even when absent at startup', () => {
    // Extensions can inject after this module is evaluated, so absence at load
    // is not proof of absence on a device that plausibly has one.
    expect(kinds({ walletConnect: false, hasInjected: false, touchPrimary: false })).toContain(
      'injected',
    );
  });

  it('adds the WalletConnect wallets only once a project id exists', () => {
    const without = kinds({ walletConnect: false, hasInjected: true, touchPrimary: false });
    expect(without).not.toContain('walletConnect');
    expect(without).not.toContain('metaMask');

    const with_ = kinds({ walletConnect: true, hasInjected: true, touchPrimary: false });
    expect(with_).toEqual(
      expect.arrayContaining(['metaMask', 'rainbow', 'trust', 'walletConnect']),
    );
  });

  it('never repeats a wallet across groups', () => {
    const offered = kinds({ walletConnect: true, hasInjected: true, touchPrimary: false });
    expect(new Set(offered).size).toBe(offered.length);
  });
});

describe('degraded support', () => {
  it('flags the configuration that leaves phones with the least', () => {
    expect(
      walletSupportIsDegraded({ walletConnect: false, hasInjected: false, touchPrimary: true }),
    ).toBe(true);
  });

  it('is not flagged once WalletConnect is configured, or on desktop', () => {
    expect(
      walletSupportIsDegraded({ walletConnect: true, hasInjected: false, touchPrimary: true }),
    ).toBe(false);
    expect(
      walletSupportIsDegraded({ walletConnect: false, hasInjected: false, touchPrimary: false }),
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { selectWallets, walletSupportIsDegraded } from './walletSelection';

/**
 * Defaults `injectedIsMetaMask` to false so each case states only what it is
 * about. The MetaMask-specific cases set it explicitly.
 */
const kinds = (
  environment: Omit<Parameters<typeof selectWallets>[0], 'injectedIsMetaMask'> &
    Partial<Pick<Parameters<typeof selectWallets>[0], 'injectedIsMetaMask'>>,
) => selectWallets({ injectedIsMetaMask: false, ...environment }).flatMap((group) => group.kinds);

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

describe('one door to MetaMask', () => {
  /*
   * The regression this exists for is subtler than a dead option: two entries
   * both reach MetaMask, but by different connectors. Whichever one a person
   * clicks decides whether the wallet prompts for permission and whether the
   * connection survives a reload — so the same app behaves differently for two
   * people who did the same thing.
   */
  it('drops the dedicated entry when the extension is already the injected one', () => {
    const offered = kinds({
      walletConnect: true,
      hasInjected: true,
      injectedIsMetaMask: true,
      touchPrimary: false,
    });
    expect(offered).toContain('injected');
    expect(offered).not.toContain('metaMask');
  });

  it('keeps the dedicated entry when the injected wallet is something else', () => {
    // Rabby, Brave and friends inject too. MetaMask then still deserves a row,
    // because it is a different wallet rather than the same one twice.
    const offered = kinds({
      walletConnect: true,
      hasInjected: true,
      injectedIsMetaMask: false,
      touchPrimary: false,
    });
    expect(offered).toContain('injected');
    expect(offered).toContain('metaMask');
  });

  it('leads with direct MetaMask WalletConnect on a phone, not the MetaMask SDK', () => {
    /*
     * The reported failure: MetaMask opened with nothing to sign. RainbowKit
     * chooses the connector by environment — `!injected && !isMobile()` — so on
     * a phone the dedicated entry is MetaMask's SDK, which hands off through a
     * `metamask.app.link` universal link. The OS offers that URL to any browser
     * that claims it, and the session does not survive the detour.
     */
    const groups = selectWallets({
      walletConnect: true,
      hasInjected: false,
      injectedIsMetaMask: false,
      touchPrimary: true,
    });
    const offered = groups.flatMap((group) => group.kinds);
    expect(offered).not.toContain('metaMask');
    expect(offered).not.toContain('injected');
    // And the direct WalletConnect-backed MetaMask path must lead, without also
    // offering the slower generic wallet-picker route.
    expect(groups[0].kinds).toContain('metaMaskWalletConnect');
    expect(offered).not.toContain('walletConnect');
  });

  it('offers only the in-app wallet inside MetaMask on a phone', () => {
    // A wallet's own browser injects a provider, so the injected path applies
    // and there is no hand-off between apps left to fail.
    const offered = kinds({
      walletConnect: true,
      hasInjected: true,
      injectedIsMetaMask: true,
      touchPrimary: true,
    });
    expect(offered).toContain('injected');
    expect(offered).not.toContain('metaMask');
  });
});

describe('degraded support', () => {
  it('flags the configuration that leaves phones with the least', () => {
    expect(
      walletSupportIsDegraded({
        walletConnect: false,
        hasInjected: false,
        injectedIsMetaMask: false,
        touchPrimary: true,
      }),
    ).toBe(true);
  });

  it('is not flagged once WalletConnect is configured, or on desktop', () => {
    expect(
      walletSupportIsDegraded({
        walletConnect: true,
        hasInjected: false,
        injectedIsMetaMask: false,
        touchPrimary: true,
      }),
    ).toBe(false);
    expect(
      walletSupportIsDegraded({
        walletConnect: false,
        hasInjected: false,
        injectedIsMetaMask: false,
        touchPrimary: false,
      }),
    ).toBe(false);
  });
});

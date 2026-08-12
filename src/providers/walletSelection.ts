/**
 * Which wallets to offer, given what the device can actually do.
 *
 * Kept pure and separate from the wagmi config so it can be tested. The bug it
 * exists to prevent is silent and total: a phone has no injected EIP-1193
 * provider, so offering "Browser Wallet" there presents the only option as
 * something that cannot exist, and the user simply cannot connect at all.
 */

export interface WalletEnvironment {
  /** A real Reown project id is configured, so WalletConnect can be built. */
  walletConnect: boolean;
  /** `window.ethereum` is present — an extension, or a wallet's in-app browser. */
  hasInjected: boolean;
  /** Touch is the primary input, i.e. a phone or tablet rather than a desktop. */
  touchPrimary: boolean;
}

export type WalletKind =
  'injected' | 'coinbase' | 'metaMask' | 'rainbow' | 'trust' | 'walletConnect';

export interface WalletGroup {
  groupName: string;
  kinds: WalletKind[];
}

/**
 * Coinbase is offered unconditionally because it is the one mobile-capable
 * connector that needs no Reown project id — it deep-links through Coinbase's
 * own SDK. Without a project id it is the *only* thing a phone can use, which
 * makes it the difference between a broken connect screen and a working one.
 */
export function selectWallets(environment: WalletEnvironment): WalletGroup[] {
  const { walletConnect, hasInjected, touchPrimary } = environment;

  /*
   * On a desktop the injected option is always shown: extensions sometimes
   * inject after this module is evaluated, so absence at startup is not proof
   * of absence. On a touch device the check is trusted, because a phone with no
   * provider genuinely has none — and listing a dead option there is worse than
   * listing nothing.
   */
  const showInjected = hasInjected || !touchPrimary;

  const primary: WalletKind[] = [];
  if (showInjected) primary.push('injected');
  primary.push('coinbase');
  if (walletConnect) primary.push('metaMask');

  const more: WalletKind[] = walletConnect ? ['rainbow', 'trust', 'walletConnect'] : [];

  return more.length > 0
    ? [
        { groupName: 'Recommended', kinds: primary },
        { groupName: 'More wallets', kinds: more },
      ]
    : [{ groupName: 'Available wallets', kinds: primary }];
}

/**
 * True when the device can reach no wallet the app can talk to.
 *
 * Only reachable on a touch device with no injected provider and no
 * WalletConnect — the configuration that silently blocks every phone. Coinbase
 * still works in that state, so this is about warning the operator rather than
 * the user.
 */
export function walletSupportIsDegraded(environment: WalletEnvironment): boolean {
  return environment.touchPrimary && !environment.hasInjected && !environment.walletConnect;
}

/** Reads the current browser. Separated so tests never touch globals. */
export function detectWalletEnvironment(walletConnect: boolean): WalletEnvironment {
  const hasInjected =
    typeof window !== 'undefined' &&
    typeof (window as { ethereum?: unknown }).ethereum !== 'undefined';
  // `pointer: coarse` rather than a user-agent string: it describes the input
  // the person actually has, and does not need updating for every new device.
  const touchPrimary =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  return { walletConnect, hasInjected, touchPrimary };
}

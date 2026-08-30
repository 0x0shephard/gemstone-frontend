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
  /**
   * The injected provider is MetaMask itself.
   *
   * Decides whether the dedicated MetaMask entry would be a second door to the
   * same wallet. Listing both is not merely untidy: the two take different code
   * paths — one the injected connector, the other MetaMask's SDK — so which one
   * a person happens to click changes whether they are prompted for permission
   * and whether the connection survives a reload.
   */
  injectedIsMetaMask: boolean;
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
  const { walletConnect, hasInjected, injectedIsMetaMask, touchPrimary } = environment;

  /*
   * On a desktop the injected option is always shown: extensions sometimes
   * inject after this module is evaluated, so absence at startup is not proof
   * of absence. On a touch device the check is trusted, because a phone with no
   * provider genuinely has none — and listing a dead option there is worse than
   * listing nothing.
   */
  const showInjected = hasInjected || !touchPrimary;

  /*
   * Exactly one door to MetaMask, whichever environment this is.
   *
   * When the extension is present the injected entry already *is* MetaMask, and
   * the injected connector is the better of the two paths: it asks the wallet
   * for permission on connect, which is what raises the account prompt, and it
   * hands wagmi a target so an existing authorisation survives a reload.
   *
   * Offering both was the original fault. The workaround for it — a hand-rolled
   * injected connector with `shimDisconnect: false` — silently disabled the
   * permission prompt and the reconnect path.
   */
  const metaMaskIsDuplicate = showInjected && injectedIsMetaMask;

  /*
   * A phone browser with no wallet of its own, where the dedicated MetaMask
   * entry must lead.
   *
   * The MetaMask entry now uses MetaMask Connect rather than RainbowKit's
   * deprecated SDK or a WalletConnect pairing. MetaMask Connect owns the
   * cross-app hand-off and restores its session after Chrome/Safari returns,
   * so this is the preferred path on every phone without an injected wallet.
   */
  const phoneWithoutWallet = touchPrimary && !hasInjected;

  const primary: WalletKind[] = [];
  if (showInjected) primary.push('injected');
  if (!metaMaskIsDuplicate) primary.push('metaMask');
  primary.push('coinbase');

  const more: WalletKind[] = !walletConnect
    ? []
    : phoneWithoutWallet
      ? ['rainbow', 'trust']
      : ['rainbow', 'trust', 'walletConnect'];

  return more.length > 0
    ? [
        { groupName: 'Recommended', kinds: primary },
        { groupName: 'More wallets', kinds: more },
      ]
    : [{ groupName: 'Available wallets', kinds: primary }];
}

/**
 * Whether an injected provider is really MetaMask.
 *
 * `isMetaMask` is set by a long tail of wallets that impersonate it for
 * compatibility, so the flag alone means little. The ones checked here are the
 * wallets common enough to actually appear, each of which advertises itself
 * under its own flag as well — a wallet not on this list is at worst offered a
 * MetaMask entry it does not need, which is the mild failure of the two.
 */
function looksLikeMetaMask(ethereum: Record<string, unknown> | undefined): boolean {
  if (!ethereum?.isMetaMask) return false;
  return ![
    'isBraveWallet',
    'isCoinbaseWallet',
    'isPhantom',
    'isRabby',
    'isTrust',
    'isTrustWallet',
    'isOkxWallet',
    'isOKExWallet',
    'isExodus',
    'isFrame',
    'isOpera',
    'isZerion',
  ].some((flag) => ethereum[flag]);
}

/** Reads the current browser. Separated so tests never touch globals. */
export function detectWalletEnvironment(walletConnect: boolean): WalletEnvironment {
  const ethereum =
    typeof window === 'undefined'
      ? undefined
      : ((window as { ethereum?: Record<string, unknown> }).ethereum ?? undefined);
  const hasInjected = ethereum !== undefined;
  // `pointer: coarse` rather than a user-agent string: it describes the input
  // the person actually has, and does not need updating for every new device.
  const touchPrimary =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  return {
    walletConnect,
    hasInjected,
    injectedIsMetaMask: looksLikeMetaMask(ethereum),
    touchPrimary,
  };
}

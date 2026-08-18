import type { Address, Hash, Hex } from 'viem';

interface WalletConnectNamespace {
  accounts?: string[];
  chains?: string[];
}

interface WalletConnectSigner {
  request: (
    request: { method: string; params?: readonly unknown[] },
    chainId: string,
  ) => Promise<unknown>;
}

export interface WalletConnectProviderLike {
  session?: {
    namespaces?: Record<string, WalletConnectNamespace>;
  };
  signer?: WalletConnectSigner;
}

export interface RoutedWalletTransaction {
  from: Address;
  to: Address;
  data: Hex;
  value?: Hex;
}

const caipChain = (chainId: number) => `eip155:${chainId}`;

/** Whether the existing WalletConnect session authorised a particular chain. */
export function walletConnectSupportsChain(
  provider: WalletConnectProviderLike,
  chainId: number,
): boolean {
  const target = caipChain(chainId);
  const namespaces = provider.session?.namespaces ?? {};
  return Object.entries(namespaces).some(
    ([key, namespace]) =>
      key === target ||
      namespace.chains?.includes(target) ||
      namespace.accounts?.some((account) => account.startsWith(`${target}:`)),
  );
}

/**
 * Sends on the requested CAIP-2 chain instead of changing MetaMask's global UI.
 *
 * MetaMask Mobile exposes a multichain WalletConnect session. Its
 * `wallet_switchEthereumChain` handler currently opens the wallet home screen
 * without a confirmation or `chainChanged` response. UniversalProvider already
 * supports routing a request to a session chain directly, which is both what
 * the session is for and what avoids that dead end.
 */
export async function requestWalletConnectTransaction(
  provider: WalletConnectProviderLike,
  chainId: number,
  transaction: RoutedWalletTransaction,
): Promise<Hash> {
  if (!provider.signer?.request) {
    throw new Error('The WalletConnect session cannot route a transaction. Reconnect the wallet.');
  }
  const result = await provider.signer.request(
    { method: 'eth_sendTransaction', params: [transaction] },
    caipChain(chainId),
  );
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
    throw new Error('The wallet returned an invalid transaction hash.');
  }
  return result as Hash;
}

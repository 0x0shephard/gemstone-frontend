import {
  getWalletConnectConnector,
  type RainbowKitWalletConnectParameters,
  type Wallet,
} from '@rainbow-me/rainbowkit';
import { metaMaskWallet } from '@rainbow-me/rainbowkit/wallets';
import type { CreateConnectorFn } from 'wagmi';

/**
 * WalletConnect sessions can authorise several chains at once. Asking the
 * connector to also change MetaMask's global UI chain during `connect` adds a
 * second, hidden wallet request after the user has already approved pairing.
 * MetaMask Mobile often never answers that request, leaving RainbowKit's
 * connect modal spinning even though the wallet says it is connected.
 */
export function connectWithoutChainSwitch(connectorFactory: CreateConnectorFn): CreateConnectorFn {
  return (config) => {
    const connector = connectorFactory(config);
    return {
      ...connector,
      async connect(parameters = {}) {
        const sessionParameters = { ...parameters };
        delete sessionParameters.chainId;
        return connector.connect(sessionParameters);
      },
    };
  };
}

interface MobileMetaMaskWalletOptions {
  projectId: string;
  walletConnectParameters?: RainbowKitWalletConnectParameters;
}

/**
 * A direct MetaMask button for phone browsers, backed by WalletConnect.
 *
 * The generic WalletConnect entry first opens a wallet-picker modal. This
 * converts the pairing URI straight to MetaMask's universal link, removing
 * that extra discovery hop while retaining the relay session that survives an
 * iOS app switch.
 */
export function mobileMetaMaskWallet({
  projectId,
  walletConnectParameters,
}: MobileMetaMaskWalletOptions): Wallet {
  const appearance = metaMaskWallet({ projectId, walletConnectParameters });
  const createConnector = getWalletConnectConnector({ projectId, walletConnectParameters });

  return {
    ...appearance,
    id: 'metaMaskWalletConnect',
    name: 'MetaMask',
    mobile: {
      getUri: (uri) => `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`,
    },
    createConnector: (walletDetails) => connectWithoutChainSwitch(createConnector(walletDetails)),
  };
}

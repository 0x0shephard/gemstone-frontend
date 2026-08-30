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

interface MobileBrowserIdentity {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/**
 * Convert a WalletConnect pairing URI into the MetaMask hand-off that is safe
 * for the current mobile operating system.
 *
 * RainbowKit opens HTTP(S) wallet links in a new tab. That is desirable on
 * iOS, where a universal link hands Safari or Chrome to MetaMask without
 * navigating the dapp tab. On Android the same `metamask.app.link` URL first
 * opens an activity chooser and can leave Chrome on a new page. The approval
 * then returns to a browser context that does not own the pending WalletConnect
 * promise, so MetaMask says it connected while the dapp still says it did not.
 *
 * A custom scheme makes RainbowKit assign the URI to the current Android tab.
 * Android hands that navigation straight to MetaMask, preserving the dapp page
 * and its live connector for the return. iOS keeps MetaMask's universal link,
 * which is the path MetaMask and WebKit support reliably across both Safari
 * and iOS Chrome.
 */
export function metaMaskMobileUri(
  uri: string,
  browser: MobileBrowserIdentity | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator,
): string {
  const encodedUri = encodeURIComponent(uri);
  const platform = browser?.userAgentData?.platform ?? browser?.platform ?? '';
  return /android/i.test(`${browser?.userAgent ?? ''} ${platform}`)
    ? `metamask://wc?uri=${encodedUri}`
    : `https://metamask.app.link/wc?uri=${encodedUri}`;
}

/**
 * A direct MetaMask button for phone browsers, backed by WalletConnect.
 *
 * The generic WalletConnect entry first opens a wallet-picker modal. This
 * converts the pairing URI straight to the platform-appropriate MetaMask link,
 * removing that extra discovery hop while retaining the relay session that
 * survives a browser/app switch.
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
      getUri: metaMaskMobileUri,
    },
    createConnector: (walletDetails) => connectWithoutChainSwitch(createConnector(walletDetails)),
  };
}

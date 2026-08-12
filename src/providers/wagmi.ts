import { getDefaultConfig, type WalletList } from '@rainbow-me/rainbowkit';
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createConnector } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { env, walletConnectConfigured } from '@/config/env';
import { activeChain, supportedChains } from '@/config/chains';
import { createRpcTransport, resolveRpcUrls } from '@/config/rpc';
import { detectWalletEnvironment, selectWallets, type WalletKind } from './walletSelection';

const rpcTransport = createRpcTransport(
  resolveRpcUrls(activeChain.id, env.rpcUrl, env.rpcFallbackUrl),
);

const browserWallet = () => {
  const wallet = injectedWallet();
  return {
    ...wallet,
    name: 'MetaMask / Browser Wallet',
    shortName: 'Browser Wallet',
    createConnector: (walletDetails: Parameters<typeof wallet.createConnector>[0]) =>
      createConnector((config) => ({
        ...injected({ shimDisconnect: false })(config),
        ...walletDetails,
      })),
  };
};

type WalletCreator = WalletList[number]['wallets'][number];

const WALLETS: Record<WalletKind, WalletCreator> = {
  injected: browserWallet,
  coinbase: coinbaseWallet,
  metaMask: metaMaskWallet,
  rainbow: rainbowWallet,
  trust: trustWallet,
  walletConnect: walletConnectWallet,
};

/**
 * Wallet options, chosen from what the device can actually reach.
 *
 * A phone has no injected EIP-1193 provider, so a configuration that offers
 * only the browser wallet leaves every mobile visitor unable to connect —
 * silently, because the option is listed and simply never works. Coinbase is
 * always included since it deep-links through its own SDK and needs no Reown
 * project id; the rest appear once one is configured.
 */
const wallets = selectWallets(detectWalletEnvironment(walletConnectConfigured)).map((group) => ({
  groupName: group.groupName,
  wallets: group.kinds.map((kind) => WALLETS[kind]),
}));

export const wagmiConfig = getDefaultConfig({
  appName: 'Digital Carat',
  // Only WalletConnect-backed wallets need this, and they are excluded unless a
  // real id exists — so the placeholder can never leave a modal waiting on it.
  projectId: env.walletConnectProjectId || 'injected-wallet-only',
  wallets,
  chains: supportedChains,
  transports: {
    [activeChain.id]: rpcTransport,
  },
  multiInjectedProviderDiscovery: false,
  ssr: false,
});

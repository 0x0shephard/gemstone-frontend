import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { injectedWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { env, walletConnectConfigured } from '@/config/env';
import { activeChain, supportedChains } from '@/config/chains';
import { createRpcTransport, resolveRpcUrls } from '@/config/rpc';

const rpcTransport = createRpcTransport(
  resolveRpcUrls(activeChain.id, env.rpcUrl, env.rpcFallbackUrl),
);

const browserWallet = () => ({
  ...injectedWallet(),
  name: 'MetaMask / Browser Wallet',
  shortName: 'Browser Wallet',
});

const wallets = [
  {
    groupName: walletConnectConfigured ? 'Available wallets' : 'Browser wallet',
    wallets: walletConnectConfigured ? [browserWallet, walletConnectWallet] : [browserWallet],
  },
];

/**
 * Browser extensions connect directly through the injected EIP-1193 provider.
 * WalletConnect is only constructed when Reown supplied a real project ID, so
 * an absent optional integration cannot leave the modal waiting on a fake ID.
 */
export const wagmiConfig = getDefaultConfig({
  appName: 'Digital Carat',
  projectId: env.walletConnectProjectId || 'injected-wallet-only',
  wallets,
  chains: supportedChains,
  transports: {
    [activeChain.id]: rpcTransport,
  },
  ssr: false,
});

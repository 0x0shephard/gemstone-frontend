import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { env, walletConnectConfigured } from '@/config/env';
import { activeChain, supportedChains } from '@/config/chains';
import { createRpcTransport, resolveRpcUrls } from '@/config/rpc';

const rpcTransport = createRpcTransport(
  resolveRpcUrls(activeChain.id, env.rpcUrl, env.rpcFallbackUrl),
);

/**
 * wagmi + RainbowKit config. A WalletConnect projectId is required for the
 * modal; when absent we still build a config (injected/browser wallets work)
 * with a development-only project identifier.
 */
export const wagmiConfig = getDefaultConfig({
  appName: 'Digital Carat',
  projectId: walletConnectConfigured ? env.walletConnectProjectId : 'DIGITAL_CARAT_DEV',
  chains: supportedChains,
  transports: {
    [activeChain.id]: rpcTransport,
  },
  ssr: false,
});

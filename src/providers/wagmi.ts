import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { env, walletConnectConfigured } from '@/config/env';
import { activeChain, supportedChains } from '@/config/chains';

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
    [activeChain.id]: http(env.rpcUrl || undefined),
  },
  ssr: false,
});

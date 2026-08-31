import { getDefaultConfig, type WalletList } from '@rainbow-me/rainbowkit';
import {
  coinbaseWallet,
  injectedWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createPublicClient, http } from 'viem';
import { env, walletConnectConfigured } from '@/config/env';
import { activeChain, supportedChains } from '@/config/chains';
import {
  createRpcTransport,
  resolveRpcUrls,
  SEPOLIA_LOGS_RPC,
  SEPOLIA_PUBLIC_RPC,
} from '@/config/rpc';
import { detectWalletEnvironment, selectWallets, type WalletKind } from './walletSelection';
import { mobileMetaMaskWallet } from './mobileMetaMaskWallet';

const rpcTransport = createRpcTransport(
  resolveRpcUrls(activeChain.id, env.rpcUrl, env.rpcFallbackUrl),
);

/**
 * Historical logs have different provider requirements from ordinary reads.
 * Keep them off the configured Alchemy free tier, whose ten-block cap would
 * turn a fresh 260k-block projection into tens of thousands of requests.
 * `scanLogs` tries these clients in order and adapts to the provider's range.
 */
export const projectionLogClients =
  activeChain.id === 11155111
    ? [
        createPublicClient({
          chain: activeChain,
          transport: http(SEPOLIA_LOGS_RPC, { retryCount: 0, timeout: 15_000 }),
        }),
        createPublicClient({
          chain: activeChain,
          transport: http(SEPOLIA_PUBLIC_RPC, { retryCount: 0, timeout: 15_000 }),
        }),
      ]
    : [];

/**
 * The browser extension, named for what it usually is.
 *
 * Only the label is changed. An earlier version replaced the connector too, with
 * a hand-rolled `injected({ shimDisconnect: false })` carrying no target, to stop
 * a duplicate MetaMask entry appearing. Both of those overrides did damage:
 *
 *   `shimDisconnect` is the sole gate on `wallet_requestPermissions`, so turning
 *   it off removed the wallet's own account prompt — connecting silently reused
 *   whatever authorisation existed, and there was no way to pick an account.
 *
 *   Without a target, `isAuthorized` falls back to requiring an
 *   `injected.connected` flag that `disconnect` deletes, so an authorised wallet
 *   read as unauthorised and every visit began by connecting again.
 *
 * The duplicate is now prevented where it arises, in `selectWallets`, which is
 * cheaper than paying for it here.
 */
const browserWallet = () => ({
  ...injectedWallet(),
  name: 'MetaMask / Browser Wallet',
  shortName: 'Browser Wallet',
});

type WalletCreator = WalletList[number]['wallets'][number];

const WALLETS: Record<WalletKind, WalletCreator> = {
  injected: browserWallet,
  coinbase: coinbaseWallet,
  metaMask: mobileMetaMaskWallet,
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
    /*
     * The other configured chains get a default transport rather than ours.
     *
     * They are listed so a wallet arriving on the wrong network can be seen and
     * switched away from, not so the app reads from them — and pointing them at
     * the Sepolia RPC would answer questions about a chain with the wrong data.
     * `http()` with no URL uses the chain's own public endpoint, which is never
     * asked for anything beyond identifying where the wallet is.
     */
    ...Object.fromEntries(
      supportedChains
        .filter((chain) => chain.id !== activeChain.id)
        .map((chain) => [chain.id, http()]),
    ),
  },
  multiInjectedProviderDiscovery: false,
  ssr: false,
});

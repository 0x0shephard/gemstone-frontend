import type {
  Address,
  EIP1193Provider,
  EventHandlers,
  Hex,
  MetamaskConnectEVM,
  createEVMClient,
} from '@metamask/connect-evm';
import { type Wallet } from '@rainbow-me/rainbowkit';
import { metaMaskWallet } from '@rainbow-me/rainbowkit/wallets';
import { ChainNotConfiguredError, extractRpcUrls } from '@wagmi/core';
import { createConnector, type Connector, type CreateConnectorFn } from 'wagmi';
import {
  getAddress,
  numberToHex,
  ResourceUnavailableRpcError,
  type RpcError,
  SwitchChainError,
  UserRejectedRequestError,
  withRetry,
  withTimeout,
} from 'viem';

type CreateMetaMaskClient = typeof createEVMClient;
type ConnectParameters = Parameters<Connector['connect']>[0];
type SwitchChainParameters = Parameters<NonNullable<Connector['switchChain']>>[0];

interface MetaMaskConnectConnectorOptions {
  createClient?: CreateMetaMaskClient;
}

/**
 * MetaMask's current remote connector adapted to wagmi v2.
 *
 * RainbowKit still supports wagmi v2, while wagmi's maintained MetaMask
 * Connect connector currently ships with wagmi v3. Keeping this small adapter
 * local lets the rest of the application stay on its supported RainbowKit
 * version while replacing the deprecated MetaMask SDK / WalletConnect mobile
 * paths with `@metamask/connect-evm`.
 */
export function metaMaskConnectConnector(
  options: MetaMaskConnectConnectorOptions = {},
): CreateConnectorFn {
  return createConnector<EIP1193Provider, { getInstance(): Promise<MetamaskConnectEVM> }>(
    (config) => {
      let instance: MetamaskConnectEVM | undefined;
      let instancePromise: Promise<MetamaskConnectEVM> | undefined;

      const connector = {
        id: 'metaMaskConnect',
        name: 'MetaMask',
        rdns: 'io.metamask',
        type: 'metaMask',

        async connect({ chainId, isReconnecting, withCapabilities }: ConnectParameters = {}) {
          const client = await this.getInstance();
          let accounts: readonly Address[] = [];
          if (isReconnecting) accounts = await this.getAccounts().catch(() => []);

          try {
            if (!accounts.length) {
              /*
               * The target chain is first so MetaMask returns on Sepolia. All
               * configured chains are authorised in the same durable session,
               * avoiding a second hidden network request after connection.
               */
              const requestedChainIds = [
                ...(chainId ? [chainId] : []),
                ...config.chains.map((chain) => chain.id),
              ];
              const chainIds = [...new Set(requestedChainIds)].map((id) => numberToHex(id));
              const result = await client.connect({ chainIds });
              accounts = result.accounts.map((account) => getAddress(account));
            }

            const currentChainId = await this.getChainId();
            return {
              accounts: (withCapabilities
                ? accounts.map((address) => ({ address, capabilities: {} }))
                : accounts) as never,
              chainId: currentChainId,
            };
          } catch (cause) {
            const error = cause as RpcError;
            if (error.code === UserRejectedRequestError.code)
              throw new UserRejectedRequestError(error);
            if (error.code === ResourceUnavailableRpcError.code)
              throw new ResourceUnavailableRpcError(error);
            throw error;
          }
        },

        async disconnect() {
          const client = await this.getInstance();
          await client.disconnect();
        },

        async getAccounts() {
          const client = await this.getInstance();
          if (client.accounts.length) return client.accounts.map((account) => getAddress(account));
          const accounts = (await client.getProvider().request({ method: 'eth_accounts' })) as
            string[] | undefined;
          return (accounts ?? []).map((account) => getAddress(account));
        },

        async getChainId() {
          const client = await this.getInstance();
          const selected = client.getChainId();
          if (selected) return Number(selected);
          return Number(await client.getProvider().request({ method: 'eth_chainId' }));
        },

        async getProvider() {
          return (await this.getInstance()).getProvider();
        },

        async isAuthorized() {
          try {
            /* MetaMask Connect restores its persisted session during client creation. */
            const accounts = await withRetry(
              () =>
                withTimeout(
                  async () => {
                    const restored = await this.getAccounts();
                    if (!restored.length) throw new Error('MetaMask session is still restoring');
                    return restored;
                  },
                  { timeout: 250 },
                ),
              { delay: 100, retryCount: 3 },
            );
            return accounts.length > 0;
          } catch {
            return false;
          }
        },

        async switchChain({ addEthereumChainParameter, chainId }: SwitchChainParameters) {
          const chain = config.chains.find((candidate) => candidate.id === Number(chainId));
          if (!chain) throw new SwitchChainError(new ChainNotConfiguredError());

          try {
            const client = await this.getInstance();
            await client.switchChain({
              chainId: numberToHex(chainId),
              chainConfiguration: {
                chainId: numberToHex(chainId),
                chainName: addEthereumChainParameter?.chainName ?? chain.name,
                nativeCurrency: addEthereumChainParameter?.nativeCurrency ?? chain.nativeCurrency,
                rpcUrls: addEthereumChainParameter?.rpcUrls
                  ? [...addEthereumChainParameter.rpcUrls]
                  : [...chain.rpcUrls.default.http],
                blockExplorerUrls: addEthereumChainParameter?.blockExplorerUrls
                  ? [...addEthereumChainParameter.blockExplorerUrls]
                  : chain.blockExplorers?.default.url
                    ? [chain.blockExplorers.default.url]
                    : undefined,
                iconUrls: addEthereumChainParameter?.iconUrls,
              },
            });
            return chain;
          } catch (cause) {
            const error = cause as RpcError;
            if (error.code === UserRejectedRequestError.code)
              throw new UserRejectedRequestError(error);
            throw new SwitchChainError(error);
          }
        },

        onAccountsChanged(accounts: string[]) {
          config.emitter.emit('change', {
            accounts: accounts.map((account) => getAddress(account)),
          });
        },

        onChainChanged(chainId: string) {
          config.emitter.emit('change', { chainId: Number(chainId) });
        },

        async onConnect({ accounts, chainId }: { accounts: Address[]; chainId: string }) {
          if (!accounts.length) return;
          config.emitter.emit('connect', {
            accounts: accounts.map((account) => getAddress(account)),
            chainId: Number(chainId),
          });
        },

        onDisconnect() {
          config.emitter.emit('disconnect');
        },

        async getInstance() {
          if (!instancePromise) {
            const createClient =
              options.createClient ??
              (async (...parameters: Parameters<CreateMetaMaskClient>) => {
                const module = await import('@metamask/connect-evm');
                return module.createEVMClient(...parameters);
              });

            const supportedNetworks = Object.fromEntries(
              config.chains.map((chain) => [
                numberToHex(chain.id),
                extractRpcUrls({ chain, transports: config.transports })?.[0] ??
                  chain.rpcUrls.default.http[0] ??
                  '',
              ]),
            ) as Record<Hex, string>;

            const handlers: Partial<EventHandlers> = {
              accountsChanged: connector.onAccountsChanged.bind(connector),
              chainChanged: connector.onChainChanged.bind(connector),
              connect: connector.onConnect.bind(connector),
              disconnect: connector.onDisconnect.bind(connector),
            };

            instancePromise = createClient({
              dapp: {
                name: 'Digital Carat',
                url:
                  typeof window === 'undefined' ? 'https://digitalcarat.io' : window.location.href,
                iconUrl: 'https://digitalcarat.io/favicon.svg',
              },
              api: { supportedNetworks },
              analytics: { enabled: false, integrationType: 'wagmi-rainbowkit' },
              eventHandlers: handlers,
              skipAutoAnnounce: true,
              ui: {
                preferExtension: false,
                showInstallModal: true,
              },
            });
          }
          instance = await instancePromise;
          return instance;
        },
      };

      return connector;
    },
  );
}

interface MobileMetaMaskWalletOptions {
  projectId: string;
}

/**
 * RainbowKit presentation for MetaMask backed by MetaMask Connect.
 *
 * MetaMask Connect owns mobile deeplinking and persists the approved session
 * across browser/app switches. It therefore does not need a Reown project id,
 * a WalletConnect URI transform, or a platform-specific browser workaround.
 */
export function mobileMetaMaskWallet({ projectId }: MobileMetaMaskWalletOptions): Wallet {
  const appearance = metaMaskWallet({ projectId });
  return {
    ...appearance,
    id: 'metaMaskConnect',
    name: 'MetaMask',
    mobile: { getUri: (uri) => uri },
    qrCode: undefined,
    createConnector: (walletDetails) =>
      createConnector((config) => ({
        ...metaMaskConnectConnector()(config),
        ...walletDetails,
      })),
  };
}

import type { MetamaskConnectEVM } from '@metamask/connect-evm';
import { describe, expect, it, vi } from 'vitest';
import { createConfig, http } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';
import { metaMaskConnectConnector, mobileMetaMaskWallet } from './mobileMetaMaskWallet';

const account = '0x0000000000000000000000000000000000000001' as const;

function configuredConnector(restoredAccounts: string[] = []) {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_accounts') return restoredAccounts;
    if (method === 'eth_chainId') return '0xaa36a7';
    return undefined;
  });
  const client = {
    accounts: restoredAccounts,
    connect: vi.fn(async () => ({ accounts: [account], chainId: '0xaa36a7' })),
    disconnect: vi.fn(async () => undefined),
    getChainId: vi.fn(() => '0xaa36a7'),
    getProvider: vi.fn(() => ({ request })),
    switchChain: vi.fn(async () => undefined),
  } as unknown as MetamaskConnectEVM;
  const createClient = vi.fn(async () => client);
  const config = createConfig({
    chains: [sepolia, mainnet],
    connectors: [metaMaskConnectConnector({ createClient })],
    transports: {
      [sepolia.id]: http('https://rpc.sepolia.example'),
      [mainnet.id]: http('https://rpc.mainnet.example'),
    },
  });

  return { client, connector: config.connectors[0], createClient };
}

describe('mobile MetaMask Connect', () => {
  it('uses MetaMask Connect rather than identifying as WalletConnect', () => {
    const { connector } = configuredConnector();
    expect(connector.id).toBe('metaMaskConnect');
    expect(connector.type).toBe('metaMask');
  });

  it('requests Sepolia first and authorises all configured networks in one session', async () => {
    const { client, connector, createClient } = configuredConnector();

    const result = await connector.connect({ chainId: sepolia.id });

    expect(client.connect).toHaveBeenCalledWith({ chainIds: ['0xaa36a7', '0x1'] });
    expect(result).toMatchObject({ accounts: [account], chainId: sepolia.id });
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        analytics: { enabled: false, integrationType: 'wagmi-rainbowkit' },
        api: {
          supportedNetworks: {
            '0x1': 'https://rpc.mainnet.example',
            '0xaa36a7': 'https://rpc.sepolia.example',
          },
        },
        skipAutoAnnounce: true,
      }),
    );
  });

  it('restores an approved session without sending another wallet prompt', async () => {
    const { client, connector } = configuredConnector([account]);

    const result = await connector.connect({ isReconnecting: true });

    expect(client.connect).not.toHaveBeenCalled();
    expect(result).toMatchObject({ accounts: [account], chainId: sepolia.id });
    await expect(connector.isAuthorized()).resolves.toBe(true);
  });

  it('exposes the durable connector through the MetaMask wallet row', () => {
    const wallet = mobileMetaMaskWallet({ projectId: 'not-used-by-metamask-connect' });
    expect(wallet.id).toBe('metaMaskConnect');
    expect(wallet.mobile?.getUri?.('metamask://connect')).toBe('metamask://connect');

    const connector = wallet.createConnector({
      rkDetails: { id: wallet.id, name: wallet.name, isRainbowKitConnector: true },
    } as never);
    const config = createConfig({
      chains: [sepolia],
      connectors: [connector],
      transports: { [sepolia.id]: http('https://rpc.sepolia.example') },
    });
    expect(config.connectors[0]).toMatchObject({
      id: 'metaMaskConnect',
      rkDetails: { isRainbowKitConnector: true },
    });
  });
});

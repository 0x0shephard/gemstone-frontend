import { describe, expect, it, vi } from 'vitest';
import {
  isWalletConnectConnector,
  requestWalletConnectSignature,
  requestWalletConnectTransaction,
  walletConnectSupportsChain,
  type WalletConnectProviderLike,
} from './walletConnectRouting';

const hash = `0x${'1'.repeat(64)}` as const;

describe('WalletConnect chain routing', () => {
  it('recognises branded connectors backed by WalletConnect', () => {
    expect(isWalletConnectConnector({ id: 'metaMaskWalletConnect', type: 'walletConnect' })).toBe(
      true,
    );
    expect(isWalletConnectConnector({ id: 'injected', type: 'injected' })).toBe(false);
  });

  it('recognises a chain authorised through namespace accounts', () => {
    const provider: WalletConnectProviderLike = {
      session: {
        namespaces: {
          eip155: {
            accounts: [
              'eip155:1:0x0000000000000000000000000000000000000001',
              'eip155:11155111:0x0000000000000000000000000000000000000001',
            ],
          },
        },
      },
    };

    expect(walletConnectSupportsChain(provider, 11155111)).toBe(true);
    expect(walletConnectSupportsChain(provider, 10)).toBe(false);
  });

  it('routes the transaction to Sepolia without requesting a network switch', async () => {
    const request = vi.fn(async () => hash);
    const provider: WalletConnectProviderLike = { signer: { request } };
    const transaction = {
      from: '0x0000000000000000000000000000000000000001',
      to: '0x0000000000000000000000000000000000000002',
      data: '0x1234',
    } as const;

    await expect(requestWalletConnectTransaction(provider, 11155111, transaction)).resolves.toBe(
      hash,
    );
    expect(request).toHaveBeenCalledWith(
      { method: 'eth_sendTransaction', params: [transaction] },
      'eip155:11155111',
    );
  });

  it('routes SIWE signatures to Sepolia without a global network switch', async () => {
    const signature = `0x${'2'.repeat(130)}` as const;
    const request = vi.fn(async () => signature);
    const provider: WalletConnectProviderLike = { signer: { request } };
    const account = '0x0000000000000000000000000000000000000001';

    await expect(
      requestWalletConnectSignature(provider, 11155111, account, 'Sign in'),
    ).resolves.toBe(signature);
    expect(request).toHaveBeenCalledWith(
      { method: 'personal_sign', params: ['0x5369676e20696e', account] },
      'eip155:11155111',
    );
  });
});

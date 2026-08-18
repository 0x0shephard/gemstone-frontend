import { describe, expect, it, vi } from 'vitest';
import {
  requestWalletConnectTransaction,
  walletConnectSupportsChain,
  type WalletConnectProviderLike,
} from './walletConnectRouting';

const hash = `0x${'1'.repeat(64)}` as const;

describe('WalletConnect chain routing', () => {
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
});

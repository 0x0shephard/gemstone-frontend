import { describe, expect, it } from 'vitest';
import { createPublicClient, custom } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage, verifySiweMessage } from 'viem/siwe';

describe('viem SIWE verification contract', () => {
  it('accepts a public client followed by verification parameters', async () => {
    const account = privateKeyToAccount(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    const issuedAt = new Date('2026-07-25T00:00:00.000Z');
    const expirationTime = new Date('2026-07-25T00:10:00.000Z');
    const message = createSiweMessage({
      address: account.address,
      chainId: 11155111,
      domain: 'localhost:5173',
      uri: 'http://localhost:5173',
      version: '1',
      nonce: '0123456789abcdef',
      issuedAt,
      expirationTime,
    });
    const signature = await account.signMessage({ message });
    const publicClient = createPublicClient({
      transport: custom({
        request: async () => {
          throw new Error('EOA verification must not call the transport');
        },
      }),
    });

    await expect(
      verifySiweMessage(publicClient, {
        address: account.address,
        domain: 'localhost:5173',
        message,
        nonce: '0123456789abcdef',
        signature,
        time: new Date('2026-07-25T00:05:00.000Z'),
      }),
    ).resolves.toBe(true);
  });
});

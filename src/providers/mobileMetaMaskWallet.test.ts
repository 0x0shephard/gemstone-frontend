import { describe, expect, it, vi } from 'vitest';
import type { CreateConnectorFn } from 'wagmi';
import { connectWithoutChainSwitch } from './mobileMetaMaskWallet';

describe('mobile MetaMask WalletConnect', () => {
  it('finishes pairing without issuing a second global-chain switch', async () => {
    const connect = vi.fn(async (parameters?: Record<string, unknown>) => ({
      accounts: ['0x0000000000000000000000000000000000000001'],
      chainId: 1,
      parameters,
    }));
    const base = (() => ({
      id: 'walletConnect',
      name: 'WalletConnect',
      type: 'walletConnect',
      connect,
    })) as unknown as CreateConnectorFn;
    const connector = connectWithoutChainSwitch(base)({} as never);

    await connector.connect({ chainId: 11155111, isReconnecting: false });

    expect(connect).toHaveBeenCalledWith({ isReconnecting: false });
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  isAmbiguousWalletBroadcastError,
  recoverAmbiguousWalletBroadcast,
  walletErrorText,
} from './walletRpcRecovery';

const hash = `0x${'ab'.repeat(32)}` as const;

describe('mobile wallet RPC recovery', () => {
  it('recognizes the nested iOS MetaMask network-loss error', () => {
    const error = {
      name: 'UnknownRpcError',
      shortMessage: 'An unknown RPC error occurred.',
      cause: {
        message:
          'RPC 0xaa36a7 Custom eth_sendRawTransaction: Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."',
      },
    };

    expect(walletErrorText(error)).toContain('NSURLErrorDomain');
    expect(isAmbiguousWalletBroadcastError(error)).toBe(true);
  });

  it('never treats a user rejection as an ambiguous broadcast', async () => {
    const reconcile = vi.fn();
    await expect(
      recoverAmbiguousWalletBroadcast(new Error('User rejected the request'), reconcile, [0]),
    ).resolves.toBeUndefined();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('polls until the matching transaction hash becomes visible', async () => {
    const reconcile = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(hash);
    await expect(
      recoverAmbiguousWalletBroadcast(new Error('Unknown RPC error'), reconcile, [0, 0]),
    ).resolves.toBe(hash);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const HASH = `0x${'ab'.repeat(32)}` as const;
const mocks = vi.hoisted(() => ({
  account: {
    address: '0x0000000000000000000000000000000000000001' as const,
    isConnected: true,
    chainId: 11155111,
  },
  simulateContract: vi.fn(),
  switchChain: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  assertActiveDeploymentRelease: vi.fn(),
}));

vi.mock('@wagmi/core', () => ({
  getAccount: () => mocks.account,
  simulateContract: mocks.simulateContract,
  switchChain: mocks.switchChain,
  writeContract: mocks.writeContract,
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
}));
vi.mock('@/config/env', () => ({ env: { chainId: 11155111 } }));
vi.mock('@/config/contracts', () => ({
  musdcFaucetAddress: '0x0000000000000000000000000000000000000002',
}));
vi.mock('@/providers/wagmi', () => ({ wagmiConfig: {} }));
vi.mock('./deploymentReleaseGuard', () => ({
  assertActiveDeploymentRelease: mocks.assertActiveDeploymentRelease,
}));
vi.mock('./transactionPipeline', () => ({
  TransactionGuardError: class TransactionGuardError extends Error {
    constructor(message: string) {
      super(message);
    }
  },
  decodeTransactionError: (error: unknown) => error,
}));

const { claimMockUsdc } = await import('./musdcFaucet');

describe('mUSDC faucet deployment release guard', () => {
  beforeEach(() => {
    mocks.account.chainId = 11155111;
    mocks.simulateContract.mockReset();
    mocks.simulateContract.mockResolvedValue({ request: { functionName: 'claim' } });
    mocks.switchChain.mockReset();
    mocks.writeContract.mockReset();
    mocks.writeContract.mockResolvedValue(HASH);
    mocks.waitForTransactionReceipt.mockReset();
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
    mocks.assertActiveDeploymentRelease.mockReset();
    mocks.assertActiveDeploymentRelease.mockResolvedValue(undefined);
  });

  it('blocks a stale tab before the raw faucet write', async () => {
    mocks.assertActiveDeploymentRelease.mockRejectedValueOnce(
      new Error('Digital Carat was updated while this tab was open.'),
    );

    await expect(claimMockUsdc()).rejects.toThrow(/updated while this tab was open/i);
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it('checks again before each wallet interaction when a network switch is needed', async () => {
    mocks.account.chainId = 1;

    await expect(claimMockUsdc()).resolves.toEqual({ hash: HASH, status: 'success' });
    expect(mocks.assertActiveDeploymentRelease).toHaveBeenCalledTimes(2);
    expect(mocks.assertActiveDeploymentRelease.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.switchChain.mock.invocationCallOrder[0],
    );
    expect(mocks.assertActiveDeploymentRelease.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.writeContract.mock.invocationCallOrder[0],
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAbi } from 'viem';

const TOKEN = '0x0000000000000000000000000000000000000002' as const;
const TARGET = '0x0000000000000000000000000000000000000003' as const;
const HASH_A = `0x${'a'.repeat(64)}` as const;
const HASH_B = `0x${'b'.repeat(64)}` as const;

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  simulateContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getBlockNumber: vi.fn(),
  getProvider: vi.fn(),
  requestWalletConnectTransaction: vi.fn(),
  recordUnknownBroadcast: vi.fn(),
  closeWork: vi.fn(),
  findPendingBroadcast: vi.fn(),
}));

vi.mock('@wagmi/core', () => ({
  getAccount: () => ({
    address: '0x0000000000000000000000000000000000000001',
    isConnected: true,
    chainId: 1,
    connector: { id: 'walletConnect', type: 'walletConnect', getProvider: mocks.getProvider },
  }),
  getBalance: vi.fn(),
  getBlockNumber: mocks.getBlockNumber,
  getPublicClient: () => ({ getLogs: vi.fn(async () => []) }),
  readContract: mocks.readContract,
  simulateContract: mocks.simulateContract,
  switchChain: vi.fn(),
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
  writeContract: vi.fn(),
}));
vi.mock('@/providers/wagmi', () => ({ wagmiConfig: {} }));
vi.mock('@/providers/supabase', () => ({ supabase: {} }));
vi.mock('@/providers/authSnapshot', () => ({
  getTransactionAuthSnapshot: () => ({
    loading: false,
    userId: 'user-1',
    linkedWallet: '0x0000000000000000000000000000000000000001',
  }),
}));
vi.mock('@/config/env', () => ({ env: { chainId: 11155111 } }));
vi.mock('@/config/chains', () => ({ activeChain: { name: 'Sepolia' } }));
vi.mock('@/config/contracts', () => ({
  NATIVE_ASSET: '0x0000000000000000000000000000000000000000',
}));
vi.mock('./pendingWork', () => ({
  openWork: () => ({ id: 'work-1' }),
  closeWork: mocks.closeWork,
  findPendingBroadcast: mocks.findPendingBroadcast,
  recordBroadcast: vi.fn(),
  recordUnknownBroadcast: mocks.recordUnknownBroadcast,
  recordStepStatus: vi.fn(),
}));
vi.mock('./walletConnectRouting', () => ({
  isWalletConnectConnector: () => true,
  walletConnectSupportsChain: () => true,
  requestWalletConnectTransaction: mocks.requestWalletConnectTransaction,
}));

import {
  BroadcastOutcomeUnknownError,
  operationFingerprint,
  runContractTransaction,
} from './transactionPipeline';
import { acquireStepGate } from './txSteps';

describe('transaction target-chain routing', () => {
  beforeEach(() => {
    mocks.readContract.mockReset();
    mocks.readContract
      .mockResolvedValueOnce(100n) // payment balance
      .mockResolvedValueOnce(0n); // allowance
    mocks.simulateContract.mockReset();
    mocks.simulateContract.mockImplementation(async (_config, request) => ({ request }));
    mocks.waitForTransactionReceipt.mockReset();
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
    mocks.getBlockNumber.mockReset();
    mocks.getBlockNumber.mockResolvedValue(10n);
    mocks.getProvider.mockReset();
    mocks.getProvider.mockResolvedValue({});
    mocks.requestWalletConnectTransaction.mockReset();
    mocks.requestWalletConnectTransaction
      .mockResolvedValueOnce(HASH_A)
      .mockResolvedValueOnce(HASH_B);
    mocks.recordUnknownBroadcast.mockReset();
    mocks.closeWork.mockReset();
    mocks.findPendingBroadcast.mockReset();
    mocks.findPendingBroadcast.mockReturnValue(undefined);
  });

  it('pins reads, simulations, writes, and receipts when WalletConnect stays on another chain', async () => {
    await expect(
      runContractTransaction({
        address: TARGET,
        abi: parseAbi(['function execute()']),
        functionName: 'execute',
        paymentAsset: TOKEN,
        paymentAmount: 5n,
        approvals: [{ kind: 'erc20', token: TOKEN, spender: TARGET, amountOrTokenId: 5n }],
      }),
    ).resolves.toEqual({ hash: HASH_B, status: 'success' });

    expect(mocks.readContract).toHaveBeenCalledTimes(2);
    expect(mocks.readContract.mock.calls.every(([, request]) => request.chainId === 11155111)).toBe(
      true,
    );
    expect(
      mocks.simulateContract.mock.calls.every(([, request]) => request.chainId === 11155111),
    ).toBe(true);
    expect(mocks.requestWalletConnectTransaction).toHaveBeenCalledTimes(2);
    expect(
      mocks.requestWalletConnectTransaction.mock.calls.every(([, chainId]) => chainId === 11155111),
    ).toBe(true);
    expect(
      mocks.waitForTransactionReceipt.mock.calls.every(
        ([, request]) => request.chainId === 11155111,
      ),
    ).toBe(true);
  });

  it('cannot broadcast after its gesture owner unmounts during preparation', async () => {
    let finishSimulation!: (value: { request: Record<string, unknown> }) => void;
    mocks.simulateContract.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSimulation = resolve;
      }),
    );
    const release = acquireStepGate(async () => undefined);
    expect(release).toBeTypeOf('function');

    const running = runContractTransaction({
      address: TARGET,
      abi: parseAbi(['function execute()']),
      functionName: 'execute',
      paymentAsset: TOKEN,
      paymentAmount: 5n,
      approvals: [{ kind: 'erc20', token: TOKEN, spender: TARGET, amountOrTokenId: 5n }],
    });
    await vi.waitFor(() => expect(mocks.simulateContract).toHaveBeenCalledTimes(1));
    release!();
    finishSimulation({
      request: {
        address: TOKEN,
        abi: parseAbi(['function approve(address,uint256)']),
        functionName: 'approve',
        args: [TARGET, 5n],
      },
    });

    await expect(running).rejects.toThrow(/cancelled before anything was sent/i);
    expect(mocks.requestWalletConnectTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['native reserve funding', 'fundNative'],
    ['a payable marketplace purchase', 'buy'],
  ])(
    'keeps an ambiguous %s send terminal even when no hash is returned',
    async (_, functionName) => {
      mocks.readContract.mockReset();
      mocks.requestWalletConnectTransaction.mockReset();
      mocks.requestWalletConnectTransaction.mockRejectedValueOnce(
        new Error('Unknown RPC error: network connection was lost'),
      );

      const result = runContractTransaction({
        address: TARGET,
        abi: parseAbi([`function ${functionName}() payable`]),
        functionName,
        value: 1n,
      });

      await expect(result).rejects.toBeInstanceOf(BroadcastOutcomeUnknownError);
      expect(mocks.recordUnknownBroadcast).toHaveBeenCalledWith('work-1', 0);
      expect(mocks.closeWork).not.toHaveBeenCalled();
    },
  );

  it('blocks a reload retry while an unknown send remains unresolved', async () => {
    mocks.findPendingBroadcast.mockReturnValue({
      id: 'unknown-work',
      fromBlock: '50',
      steps: [{ kind: 'call', status: 'broadcast' }],
    });

    await expect(
      runContractTransaction({
        address: TARGET,
        abi: parseAbi(['function fund() payable']),
        functionName: 'fund',
        value: 1n,
      }),
    ).rejects.toBeInstanceOf(BroadcastOutcomeUnknownError);
    expect(mocks.simulateContract).not.toHaveBeenCalled();
    expect(mocks.requestWalletConnectTransaction).not.toHaveBeenCalled();
  });

  it('blocks the same semantic fund after quote drift without locking a different gem', async () => {
    const abi = parseAbi(['function fundNative(uint256 gemId) payable']);
    const gemA = {
      address: TARGET,
      abi,
      functionName: 'fundNative',
      args: [1n] as const,
      value: 1n,
      intentKey: 'fundReserve:1',
    };
    mocks.findPendingBroadcast.mockImplementation((key: string) =>
      key === 'fundReserve:1'
        ? {
            id: 'unknown-gem-a',
            operationKey: operationFingerprint(gemA),
            steps: [{ kind: 'call', status: 'broadcast' }],
          }
        : undefined,
    );

    await expect(runContractTransaction(gemA)).rejects.toBeInstanceOf(BroadcastOutcomeUnknownError);
    await expect(runContractTransaction({ ...gemA, value: 2n })).rejects.toBeInstanceOf(
      BroadcastOutcomeUnknownError,
    );
    await expect(
      runContractTransaction({
        ...gemA,
        args: [2n] as const,
        value: 2n,
        intentKey: 'fundReserve:2',
      }),
    ).resolves.toMatchObject({ status: 'success' });
  });

  it('clears an exact unknown operation only after its chain observer returns a hash', async () => {
    mocks.findPendingBroadcast.mockReturnValue({
      id: 'unknown-observed',
      fromBlock: '44',
      operationKey: 'stored-exact-call',
      steps: [{ kind: 'call', status: 'broadcast' }],
    });
    const reconcileBroadcast = vi.fn(async () => HASH_A);

    await expect(
      runContractTransaction({
        address: TARGET,
        abi: parseAbi(['function fundNative(uint256 gemId) payable']),
        functionName: 'fundNative',
        args: [1n],
        value: 1n,
        intentKey: 'fundReserve:1',
        reconcileBroadcast,
      }),
    ).resolves.toEqual({ hash: HASH_A, status: 'success' });

    expect(reconcileBroadcast).toHaveBeenCalledWith(
      '0x0000000000000000000000000000000000000001',
      44n,
      'stored-exact-call',
    );
    expect(mocks.closeWork).toHaveBeenCalledWith('unknown-observed');
    expect(mocks.requestWalletConnectTransaction).not.toHaveBeenCalled();
  });

  it('retires a hashless approval and safely replans it when allowance is still insufficient', async () => {
    mocks.findPendingBroadcast.mockReturnValue({
      id: 'unknown-approval',
      operationKey: 'old-approval-flow',
      steps: [
        { kind: 'approval', status: 'broadcast' },
        { kind: 'call', status: 'waiting' },
      ],
    });

    await expect(
      runContractTransaction({
        address: TARGET,
        abi: parseAbi(['function buy(uint256 amount)']),
        functionName: 'buy',
        args: [5n],
        intentKey: 'buy:token-1',
        paymentAsset: TOKEN,
        paymentAmount: 5n,
        approvals: [{ kind: 'erc20', token: TOKEN, spender: TARGET, amountOrTokenId: 5n }],
      }),
    ).resolves.toMatchObject({ status: 'success' });

    expect(mocks.closeWork).toHaveBeenCalledWith('unknown-approval');
    expect(mocks.requestWalletConnectTransaction).toHaveBeenCalledTimes(2);
  });
});

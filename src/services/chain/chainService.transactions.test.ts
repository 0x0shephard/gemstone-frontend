import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, zeroAddress, zeroHash } from 'viem';

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  multicall: vi.fn(),
  getBlock: vi.fn(),
  getBlockNumber: vi.fn(),
  getLogs: vi.fn(),
  getTransaction: vi.fn(),
  runContractTransaction: vi.fn(),
  syncProjection: vi.fn(),
}));

vi.mock('@wagmi/core', () => ({
  getAccount: () => ({ address: undefined }),
  getPublicClient: () => ({
    readContract: mocks.readContract,
    multicall: mocks.multicall,
    getBlock: mocks.getBlock,
    getBlockNumber: mocks.getBlockNumber,
    getLogs: mocks.getLogs,
    getTransaction: mocks.getTransaction,
  }),
}));
vi.mock('@/providers/wagmi', () => ({
  wagmiConfig: {},
  projectionLogClients: [],
}));
/*
 * A synthetic manifest, so this suite does not depend on a `.env` that only
 * exists on a configured machine. `chainService` calls
 * `requireDeploymentManifest()` at module scope and it throws when addresses are
 * missing, so without this the file cannot even be imported in CI or on a fresh
 * clone — it was failing on every run for exactly that reason.
 *
 * Every assertion below compares against `manifest.addresses.X` rather than a
 * literal, so the suite stays self-consistent whatever the values are.
 */
vi.mock('@/config/contracts', () => {
  const address = (byte: number) => `0x${byte.toString(16).padStart(2, '0').repeat(20)}` as const;
  const modules = [
    'DGENFT',
    'GemRegistry',
    'PaymentTokenRegistry',
    'ReserveManager',
    'Treasury',
    'PrimarySaleAuction',
    'Marketplace',
    'SwapEscrow',
    'RedemptionManager',
    'ComplianceRegistry',
  ] as const;
  const manifest = {
    schemaVersion: 1 as const,
    chainId: 11155111,
    deploymentBlock: 1n,
    addresses: Object.fromEntries(modules.map((name, index) => [name, address(index + 1)])),
    nativeAsset: '0x0000000000000000000000000000000000000000',
    usdc: address(0xaa),
  };
  return {
    NATIVE_ASSET: '0x0000000000000000000000000000000000000000',
    contractModules: modules,
    contractAddresses: manifest.addresses,
    getContractAddress: (name: (typeof modules)[number]) => manifest.addresses[name],
    deploymentErrors: [] as string[],
    deploymentManifest: manifest,
    deploymentManifestHash: `0x${'ab'.repeat(32)}`,
    giftOperatorAddress: address(0xfe),
    requireDeploymentManifest: () => manifest,
  };
});
vi.mock('./transactionPipeline', () => ({
  runContractTransaction: mocks.runContractTransaction,
  TransactionGuardError: class TransactionGuardError extends Error {},
}));
vi.mock('./projection', () => ({
  syncProjection: mocks.syncProjection,
}));

import { requireDeploymentManifest } from '@/config/contracts';
import { chainService, occurredAtForBlock } from './chainService';

const manifest = requireDeploymentManifest();
const usdc = manifest.usdc!;
const usd = (value: number) => BigInt(value) * 10n ** 18n;
const musdc = (value: number) => BigInt(value) * 10n ** 6n;
const txResult = { hash: `0x${'1'.repeat(64)}` as const, status: 'success' as const };
const registryGem = (priceUsd: bigint) => ({
  seller: zeroAddress,
  custodian: zeroAddress,
  metadataURI: '',
  certificateHash: zeroHash,
  priceUsd,
  tokenId: 0n,
  redemptionRequestHash: zeroHash,
  status: 4,
});

type RecoverableCall = {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  reconcileBroadcast: (account: `0x${string}`) => Promise<`0x${string}` | undefined>;
};

function mockMatchingTransaction(call: RecoverableCall, account: `0x${string}`) {
  mocks.getTransaction.mockResolvedValueOnce({
    from: account,
    to: call.address,
    input: encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
    } as never),
    value: call.value ?? 0n,
  });
}

beforeEach(() => {
  window.dispatchEvent(new CustomEvent('dc:transaction-confirmed'));
  mocks.readContract.mockReset();
  mocks.multicall.mockReset();
  mocks.getBlock.mockReset();
  mocks.getBlock.mockResolvedValue({ timestamp: 1n });
  mocks.getBlockNumber.mockReset();
  mocks.getBlockNumber.mockResolvedValue(100n);
  mocks.getLogs.mockReset();
  mocks.getTransaction.mockReset();
  mocks.getTransaction.mockResolvedValue(undefined);
  mocks.runContractTransaction.mockReset();
  mocks.runContractTransaction.mockResolvedValue(txResult);
  mocks.syncProjection.mockReset();
  mocks.syncProjection.mockResolvedValue({
    events: [],
    status: {
      latestBlock: 1n,
      scannedThrough: 1n,
      finalizedThrough: 0n,
      cached: false,
      partiallySynced: false,
    },
  });
});

describe('chain payment-asset reads', () => {
  it('projects a real block timestamp onto chain history for cross-source ordering', async () => {
    mocks.getBlock.mockResolvedValueOnce({ timestamp: 1_796_119_200n });

    await expect(occurredAtForBlock(987654n)).resolves.toBe('2026-12-01T10:00:00.000Z');
    expect(mocks.getBlock).toHaveBeenCalledWith({ blockNumber: 987654n });
  });

  it('discovers the deployment payment assets from the on-chain registry', async () => {
    mocks.readContract.mockImplementation(
      async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
        if (functionName === 'paymentTokenCount') return 2n;
        if (functionName === 'paymentTokenAt') return args?.[0] === 0n ? zeroAddress : usdc;
        if (functionName === 'isEnabled') return true;
        if (functionName === 'quoteTokenToUsd') return usd(1);
        if (functionName === 'symbol') return 'USDC';
        if (functionName === 'name') return 'USD Coin';
        if (functionName === 'decimals') return 6;
        throw new Error(`Unexpected read: ${functionName}`);
      },
    );

    await expect(chainService.getPaymentAssets()).resolves.toEqual([
      {
        address: zeroAddress,
        symbol: 'ETH',
        name: 'Sepolia Ether',
        decimals: 18,
        isNative: true,
        enabled: true,
        usdPrice: 1,
      },
      {
        address: usdc,
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        isNative: false,
        enabled: true,
        usdPrice: 1,
      },
    ]);
  });

  it('surfaces post-redemption reserve credits only for the credited holder', async () => {
    const holder = '0x5f8db7637281c6d614ea4344d21752d5ba96d3e2' as const;
    mocks.readContract.mockImplementation(
      async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
        if (functionName === 'paymentTokenCount') return 2n;
        if (functionName === 'paymentTokenAt') return args?.[0] === 0n ? zeroAddress : usdc;
        if (functionName === 'isEnabled') return true;
        if (functionName === 'quoteTokenToUsd') return usd(1);
        if (functionName === 'symbol') return 'USDC';
        if (functionName === 'name') return 'USD Coin';
        if (functionName === 'decimals') return 6;
        if (functionName === 'pendingReserveClaims') {
          expect(args?.[0]).toBe(holder);
          return args?.[1] === zeroAddress ? 250000000000000000n : 12_500_000n;
        }
        throw new Error(`Unexpected read: ${functionName}`);
      },
    );

    await expect(chainService.getPendingReserveCredits(holder)).resolves.toEqual([
      {
        paymentAsset: zeroAddress,
        symbol: 'ETH',
        amount: 250000000000000000n,
        amountFmt: '0.25 ETH',
      },
      {
        paymentAsset: usdc,
        symbol: 'USDC',
        amount: 12_500_000n,
        amountFmt: '12.5 USDC',
      },
    ]);
    await expect(chainService.getPendingReserveCredits()).resolves.toEqual([]);
  });
});

describe('chain profile reads', () => {
  it('reports a failed gem-discovery read instead of caching an empty registry', async () => {
    const rpcError = new Error('mobile RPC disconnected');
    mocks.multicall.mockResolvedValue([{ status: 'failure', error: rpcError }]);
    mocks.readContract.mockRejectedValue(rpcError);

    await expect(chainService.getGems()).rejects.toThrow('mobile RPC disconnected');
  });

  it('keeps known portfolio sections available and marks failed holdings as partial', async () => {
    const owner = '0x5f8db7637281c6d614ea4344d21752d5ba96d3e2' as const;
    const mintedGem = { ...registryGem(usd(1_000)), tokenId: 18n, status: 5 };

    mocks.multicall.mockResolvedValue([
      { status: 'success', result: mintedGem },
      { status: 'failure', error: new Error('InvalidGem') },
    ]);
    mocks.readContract.mockImplementation(
      async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
        if (functionName === 'getGem') {
          if (args?.[0] === 1n) return mintedGem;
          throw new Error('InvalidGem');
        }
        if (functionName === 'ownerOf') throw new Error('mobile ownerOf request failed');
        if (
          functionName === 'reserveBalanceUsd' ||
          functionName === 'shortfallUsd' ||
          functionName === 'requiredReserveUsd'
        ) {
          return 0n;
        }
        if (functionName === 'canRedeem') return true;
        if (functionName === 'secondaryFeeBps') return 250;
        if (functionName === 'listings') return [zeroAddress, 0n];
        throw new Error(`Unexpected read: ${functionName}`);
      },
    );

    const profile = await chainService.getProfile(owner);
    expect(profile.owned).toEqual([]);
    expect(profile.sections.holdings).toMatchObject({
      state: 'partial',
      message: expect.stringContaining('Known holdings'),
    });
  });

  it('returns owned tokens without waiting for the event projection', async () => {
    const owner = '0x5f8db7637281c6d614ea4344d21752d5ba96d3e2' as const;
    const mintedGem = { ...registryGem(usd(1_000)), tokenId: 18n, status: 5 };

    mocks.multicall.mockResolvedValue([
      { status: 'success', result: mintedGem },
      { status: 'failure', error: new Error('InvalidGem') },
    ]);
    mocks.readContract.mockImplementation(
      async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
        if (functionName === 'getGem') {
          if (args?.[0] === 1n) return mintedGem;
          throw new Error('InvalidGem');
        }
        if (functionName === 'ownerOf') return owner;
        if (
          functionName === 'reserveBalanceUsd' ||
          functionName === 'shortfallUsd' ||
          functionName === 'requiredReserveUsd'
        ) {
          return 0n;
        }
        if (functionName === 'canRedeem') return true;
        if (functionName === 'secondaryFeeBps') return 250;
        if (functionName === 'listings') return [zeroAddress, 0n];
        throw new Error(`Unexpected read: ${functionName}`);
      },
    );
    mocks.syncProjection.mockReturnValue(new Promise(() => undefined));

    const profile = await Promise.race([
      chainService.getProfile(owner),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('profile waited for projection')), 100),
      ),
    ]);

    expect(profile.stats.ownedCount).toBe(1);
    expect(profile.owned.map((gem) => gem.tokenId)).toEqual([18n]);
    expect(profile.activity).toEqual([]);
  });

  it('evicts a rejected fee read so a later portfolio refresh can recover', async () => {
    const availableGem = { ...registryGem(usd(1_000)), status: 5 };
    let feeAttempts = 0;
    mocks.multicall.mockResolvedValue([
      { status: 'success', result: availableGem },
      { status: 'failure', error: new Error('InvalidGem') },
    ]);
    mocks.readContract.mockImplementation(
      async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
        if (functionName === 'getGem') {
          if (args?.[0] === 1n) return availableGem;
          throw new Error('InvalidGem');
        }
        if (
          functionName === 'reserveBalanceUsd' ||
          functionName === 'shortfallUsd' ||
          functionName === 'requiredReserveUsd'
        )
          return 0n;
        if (functionName === 'secondaryFeeBps') {
          feeAttempts += 1;
          if (feeAttempts === 1) throw new Error('temporary fee RPC failure');
          return 250;
        }
        throw new Error(`Unexpected read: ${functionName}`);
      },
    );

    await expect(chainService.getGems()).rejects.toThrow(/catalogue could not be read/i);
    await expect(chainService.getGems()).resolves.toHaveLength(1);
    expect(feeAttempts).toBe(2);
  });
});

describe('chain fee tier reads', () => {
  it('decodes named reserve bracket structs returned by viem', async () => {
    mocks.readContract.mockImplementation(
      ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
        if (functionName === 'reserveBracketCount') return 2n;
        if (functionName === 'reserveBracket' && args?.[0] === 0n) {
          return { minPriceUsd: 0n, maxPriceUsd: usd(1_000), reserveBps: 1_000 };
        }
        if (functionName === 'reserveBracket' && args?.[0] === 1n) {
          return {
            minPriceUsd: usd(1_000),
            maxPriceUsd: (1n << 256n) - 1n,
            reserveBps: 400,
          };
        }
        throw new Error(`Unexpected read: ${functionName}`);
      },
    );

    await expect(chainService.getFeeTiers()).resolves.toEqual([
      { tier: 'Reserve 1', range: 'Under $1,000', pct: '10%' },
      { tier: 'Reserve 2', range: '$1,000 and above', pct: '4%' },
    ]);
  });
});

describe('chain transaction construction', () => {
  it('allows a direct transfer only when its reserve is above zero', async () => {
    mocks.readContract
      .mockResolvedValueOnce(manifest.addresses.Treasury)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(2n)
      .mockResolvedValueOnce(1n);

    await chainService.transferToken({ tokenId: 4n, to: manifest.addresses.ComplianceRegistry });
    expect(mocks.runContractTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'safeTransferFrom',
        args: [manifest.addresses.Treasury, manifest.addresses.ComplianceRegistry, 4n],
      }),
    );

    mocks.runContractTransaction.mockClear();
    mocks.readContract
      .mockResolvedValueOnce(manifest.addresses.Treasury)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(2n)
      .mockResolvedValueOnce(0n);
    await expect(
      chainService.transferToken({ tokenId: 4n, to: manifest.addresses.ComplianceRegistry }),
    ).rejects.toThrow(/reserve above zero/i);
    expect(mocks.runContractTransaction).not.toHaveBeenCalled();
  });

  it('quotes buy-now with reserve shortfall and approves the primary sale contract', async () => {
    mocks.readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === 'getGem') return registryGem(usd(1_000));
      if (functionName === 'shortfallUsd') return usd(50);
      if (functionName === 'quoteUsdToToken') return musdc(1_050);
      throw new Error(`Unexpected read: ${functionName}`);
    });

    await chainService.buyNow({ gemId: 2n, paymentAsset: usdc });

    expect(mocks.runContractTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        address: manifest.addresses.PrimarySaleAuction,
        functionName: 'buyNow',
        args: [2n, usdc, musdc(1_050)],
        paymentAsset: usdc,
        paymentAmount: musdc(1_050),
        approvals: [
          {
            kind: 'erc20',
            token: usdc,
            spender: manifest.addresses.PrimarySaleAuction,
            amountOrTokenId: musdc(1_050),
          },
        ],
      }),
    );
  });

  it('sends native buy-now value without requesting an ERC-20 approval', async () => {
    const nativeAmount = 250_000_000_000_000_000n;
    mocks.readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === 'getGem') return registryGem(usd(500));
      if (functionName === 'shortfallUsd') return 0n;
      if (functionName === 'quoteUsdToToken') return nativeAmount;
      throw new Error(`Unexpected read: ${functionName}`);
    });

    await chainService.buyNow({ gemId: 3n, paymentAsset: manifest.nativeAsset });

    expect(mocks.runContractTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'buyNow',
        args: [3n, manifest.nativeAsset, nativeAmount],
        value: nativeAmount,
        approvals: [],
      }),
    );
  });

  it('constructs secondary listing approval, purchase, and cancellation calls', async () => {
    await chainService.list({ tokenId: 4n, priceUsd: usd(590) });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: manifest.addresses.Marketplace,
        functionName: 'list',
        args: [4n, usd(590)],
        approvals: [
          {
            kind: 'erc721',
            token: manifest.addresses.DGENFT,
            spender: manifest.addresses.Marketplace,
            amountOrTokenId: 4n,
          },
        ],
        reconcileBroadcast: expect.any(Function),
      }),
    );
    const listTransaction = mocks.runContractTransaction.mock.calls.at(-1)?.[0] as {
      reconcileBroadcast: (account: `0x${string}`) => Promise<`0x${string}` | undefined>;
    };
    const listHash = `0x${'4'.repeat(64)}` as const;
    mocks.getLogs.mockResolvedValueOnce([
      { args: { priceUsd: usd(590) }, transactionHash: listHash },
    ]);
    await expect(listTransaction.reconcileBroadcast(manifest.addresses.Treasury)).resolves.toBe(
      listHash,
    );
    expect(mocks.getLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: { tokenId: 4n, seller: manifest.addresses.Treasury },
        fromBlock: 100n,
      }),
    );

    mocks.readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === 'listings') return [manifest.addresses.Treasury, usd(590)];
      if (functionName === 'tokenGem') return 7n;
      if (functionName === 'getGem') return registryGem(usd(520));
      if (functionName === 'shortfallUsd') return usd(20);
      if (functionName === 'quoteUsdToToken') return musdc(610);
      throw new Error(`Unexpected read: ${functionName}`);
    });
    await chainService.buy({ tokenId: 4n, paymentAsset: usdc });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: manifest.addresses.Marketplace,
        functionName: 'buy',
        args: [4n, usdc, musdc(610)],
      }),
    );

    await chainService.cancelListing({ tokenId: 4n });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: manifest.addresses.Marketplace,
        functionName: 'cancel',
        args: [4n],
      }),
    );
  });

  it('adds fresh reserve shortfall to auction bids and marketplace offers', async () => {
    mocks.readContract.mockImplementation(
      ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
        if (functionName === 'getGem') return registryGem(usd(800));
        if (functionName === 'auctions') {
          return [true, false, 0n, 1_000n, usd(800), zeroAddress, zeroAddress, 0n, 0n, 0n];
        }
        if (functionName === 'tokenGem') return 5n;
        if (functionName === 'shortfallUsd') return args?.[0] === 4n ? usd(40) : usd(55);
        if (functionName === 'quoteUsdToToken') {
          return args?.[1] === usd(840) ? musdc(840) : musdc(1_055);
        }
        throw new Error(`Unexpected read: ${functionName}`);
      },
    );

    await chainService.bid({
      gemId: 4n,
      paymentAsset: usdc,
      saleAmountUsd: usd(800),
    });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: 'bid',
        args: [4n, usdc, musdc(840)],
        reconcileBroadcast: expect.any(Function),
      }),
    );
    const bidTransaction = mocks.runContractTransaction.mock.calls.at(-1)?.[0] as RecoverableCall;
    const recoveredHash = `0x${'7'.repeat(64)}` as const;
    mocks.getLogs.mockResolvedValue([
      { args: { usdValue: usd(800) }, transactionHash: recoveredHash },
    ]);
    mockMatchingTransaction(bidTransaction, manifest.addresses.Treasury);
    await expect(bidTransaction.reconcileBroadcast(manifest.addresses.Treasury)).resolves.toBe(
      recoveredHash,
    );
    expect(mocks.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        args: { gemId: 4n, bidder: manifest.addresses.Treasury },
        fromBlock: 100n,
        toBlock: 'latest',
      }),
    );

    await chainService.createOffer({
      tokenId: 2n,
      paymentAsset: usdc,
      saleAmountUsd: usd(1_000),
    });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: manifest.addresses.Marketplace,
        functionName: 'createOffer',
        args: [2n, usdc, musdc(1_055)],
        approvals: [
          {
            kind: 'erc20',
            token: usdc,
            spender: manifest.addresses.Marketplace,
            amountOrTokenId: musdc(1_055),
          },
        ],
      }),
    );
  });

  it('constructs auction settlement/refund and marketplace offer resolution calls', async () => {
    await chainService.settleAuction({ gemId: 4n });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: manifest.addresses.PrimarySaleAuction,
        functionName: 'settleAuction',
        args: [4n],
      }),
    );

    await chainService.claimRefund({ paymentAsset: usdc });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: manifest.addresses.PrimarySaleAuction,
        functionName: 'claimRefund',
        args: [usdc],
      }),
    );

    await chainService.claimReserveCredit({
      paymentAsset: usdc,
      recipient: manifest.addresses.Treasury,
    });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: manifest.addresses.ReserveManager,
        functionName: 'claimReserveCredit',
        args: [usdc, manifest.addresses.Treasury],
      }),
    );

    mocks.readContract.mockResolvedValueOnce([
      manifest.addresses.Treasury,
      8n,
      usdc,
      musdc(500),
      usd(500),
      2_000_000_000n,
      true,
    ]);
    await chainService.acceptOffer({ offerId: 12n });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: manifest.addresses.Marketplace,
        functionName: 'acceptOffer',
        args: [12n],
        approvals: [
          {
            kind: 'erc721',
            token: manifest.addresses.DGENFT,
            spender: manifest.addresses.Marketplace,
            amountOrTokenId: 8n,
          },
        ],
      }),
    );

    await chainService.refundExpiredOffer({ offerId: 13n });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: 'cancelExpiredOffer',
        args: [13n],
      }),
    );

    await chainService.cancelOffer({ offerId: 14n });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: 'cancelOffer',
        args: [14n],
      }),
    );
  });

  it('constructs both proposer-pays and accepter-pays swap paths', async () => {
    mocks.readContract
      .mockResolvedValueOnce(musdc(100))
      .mockResolvedValueOnce(manifest.addresses.Treasury)
      .mockResolvedValueOnce(manifest.addresses.DGENFT)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    await chainService.createSwap({
      offeredTokenId: 2n,
      requestedTokenId: 3n,
      paymentAsset: usdc,
      cashAmountUsd: usd(100),
      proposerPays: true,
      expiresAt: 2_000_000_000n,
    });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: manifest.addresses.SwapEscrow,
        functionName: 'createOffer',
        args: [2n, 3n, usdc, musdc(100), true, 2_000_000_000n],
        paymentAsset: usdc,
        paymentAmount: musdc(100),
        approvals: expect.arrayContaining([
          expect.objectContaining({ kind: 'erc721', amountOrTokenId: 2n }),
          expect.objectContaining({ kind: 'erc20', amountOrTokenId: musdc(100) }),
        ]),
        reconcileBroadcast: expect.any(Function),
      }),
    );
    const swapTransaction = mocks.runContractTransaction.mock.calls.at(-1)?.[0] as RecoverableCall;
    const swapHash = `0x${'8'.repeat(64)}` as const;
    mocks.getLogs.mockResolvedValueOnce([
      {
        args: {
          requestedTokenId: 3n,
          cashAsset: usdc,
          cashAmount: musdc(100),
          proposerPaysCash: true,
          expiry: 2_000_000_000n,
        },
        transactionHash: swapHash,
      },
    ]);
    mockMatchingTransaction(swapTransaction, manifest.addresses.Treasury);
    await expect(swapTransaction.reconcileBroadcast(manifest.addresses.Treasury)).resolves.toBe(
      swapHash,
    );
    expect(mocks.getLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: { proposer: manifest.addresses.Treasury, offeredTokenId: 2n },
        fromBlock: 100n,
      }),
    );

    mocks.readContract.mockResolvedValueOnce([
      manifest.addresses.Treasury,
      2n,
      3n,
      usdc,
      musdc(75),
      false,
      2_000_000_000n,
      true,
    ]);
    await chainService.acceptSwap({ offerId: 9n });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: manifest.addresses.SwapEscrow,
        functionName: 'acceptOffer',
        args: [9n],
        paymentAsset: usdc,
        paymentAmount: musdc(75),
        approvals: expect.arrayContaining([
          expect.objectContaining({ kind: 'erc721', amountOrTokenId: 3n }),
          expect.objectContaining({ kind: 'erc20', amountOrTokenId: musdc(75) }),
        ]),
      }),
    );

    await chainService.cancelSwap({ offerId: 10n });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: manifest.addresses.SwapEscrow,
        functionName: 'cancelOffer',
        args: [10n],
      }),
    );
  });

  it('rejects a redemption-locked swap before asking the wallet for approval', async () => {
    mocks.readContract
      .mockResolvedValueOnce(manifest.addresses.Treasury)
      .mockResolvedValueOnce(manifest.addresses.DGENFT)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      chainService.createSwap({
        offeredTokenId: 9n,
        requestedTokenId: 3n,
        paymentAsset: zeroAddress,
        cashAmountUsd: 0n,
        proposerPays: false,
        expiresAt: 2_000_000_000n,
      }),
    ).rejects.toThrow(/in redemption/i);
    expect(mocks.runContractTransaction).not.toHaveBeenCalled();
  });

  it('rejects a self-swap where both tokens belong to the same wallet', async () => {
    mocks.readContract
      .mockResolvedValueOnce(manifest.addresses.Treasury)
      .mockResolvedValueOnce(manifest.addresses.Treasury)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);

    await expect(
      chainService.createSwap({
        offeredTokenId: 9n,
        requestedTokenId: 10n,
        paymentAsset: zeroAddress,
        cashAmountUsd: 0n,
        proposerPays: false,
        expiresAt: 2_000_000_000n,
      }),
    ).rejects.toThrow(/another wallet/i);
    expect(mocks.runContractTransaction).not.toHaveBeenCalled();
  });

  it('refuses an expired swap before asking the wallet for approval', async () => {
    mocks.readContract.mockResolvedValueOnce([
      manifest.addresses.Treasury,
      2n,
      3n,
      zeroAddress,
      0n,
      true,
      100n,
      true,
    ]);
    mocks.getBlock.mockResolvedValueOnce({ timestamp: 101n });

    await expect(chainService.acceptSwap({ offerId: 9n })).rejects.toThrow(/expired/i);
    expect(mocks.runContractTransaction).not.toHaveBeenCalled();
  });

  it('constructs redemption, cancellation, and reserve-funding calls', async () => {
    const requestHash = `0x${'2'.repeat(64)}` as const;
    const workflowIdHash = `0x${'3'.repeat(64)}` as const;
    await chainService.requestRedemption({ tokenId: 3n, requestHash, workflowIdHash });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: manifest.addresses.RedemptionManager,
        functionName: 'requestRedemption',
        args: [3n, requestHash, workflowIdHash],
      }),
    );

    await chainService.cancelRedemption({ tokenId: 3n });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: 'cancelRedemption',
        args: [3n],
      }),
    );

    await chainService.confirmRedemption({ tokenId: 3n });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: 'confirmRedemption',
        args: [3n],
        reconcileBroadcast: expect.any(Function),
      }),
    );
    const handoverTransaction = mocks.runContractTransaction.mock.calls.at(-1)?.[0] as {
      reconcileBroadcast: () => Promise<`0x${string}` | undefined>;
    };
    const handoverHash = `0x${'9'.repeat(64)}` as const;
    mocks.getLogs.mockResolvedValueOnce([{ args: {}, transactionHash: handoverHash }]);
    await expect(handoverTransaction.reconcileBroadcast()).resolves.toBe(handoverHash);
    expect(mocks.getLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ args: { tokenId: 3n }, fromBlock: 100n }),
    );

    mocks.readContract.mockResolvedValueOnce(musdc(50));
    await chainService.fundReserve({
      gemId: 6n,
      paymentAsset: usdc,
      amountUsd: usd(50),
    });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: manifest.addresses.ReserveManager,
        functionName: 'fundToken',
        args: [6n, usdc, musdc(50)],
        approvals: [
          {
            kind: 'erc20',
            token: usdc,
            spender: manifest.addresses.ReserveManager,
            amountOrTokenId: musdc(50),
          },
        ],
      }),
    );
  });

  it('constructs the role-separated redemption V2 calls', async () => {
    const collectorCommitment = `0x${'4'.repeat(64)}` as const;
    const proofDigest = `0x${'5'.repeat(64)}` as const;
    const approvalId = `0x${'6'.repeat(64)}` as const;
    const nonce = `0x${'7'.repeat(64)}` as const;
    const authorizer = manifest.addresses.Treasury;
    const signature = `0x${'8'.repeat(130)}` as const;

    await chainService.setCollectorCommitment({ tokenId: 3n, collectorCommitment });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: 'setCollectorCommitment',
        args: [3n, collectorCommitment],
      }),
    );

    await chainService.startRedemptionFulfillment({ tokenId: 3n });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({ functionName: 'startFulfillment', args: [3n] }),
    );

    await chainService.submitFulfillmentProof({ tokenId: 3n, proofDigest });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({ functionName: 'submitFulfillmentProof', args: [3n, proofDigest] }),
    );

    await chainService.approveFulfillmentProof({
      tokenId: 3n,
      approvalId,
      approvalVersion: 4n,
    });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: 'approveFulfillmentProof',
        args: [3n, approvalId, 4n],
      }),
    );

    await chainService.finalizeRedemption({
      tokenId: 3n,
      nonce,
      issuedAt: 100n,
      deadline: 200n,
      authorizer,
      signature,
    });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: 'finalizeRedemption',
        args: [3n, nonce, 100n, 200n, authorizer, signature],
      }),
    );
  });

  it('constructs recovery calls from an event-derived proposal hash', async () => {
    const evidenceDigest = `0x${'9'.repeat(64)}` as const;
    const proposalHash = `0x${'a'.repeat(64)}` as const;

    await chainService.proposeRedemptionRecovery({ tokenId: 3n, evidenceDigest });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: 'proposeRecovery',
        args: [3n, evidenceDigest],
        reconcileBroadcast: expect.any(Function),
      }),
    );

    await chainService.approveRedemptionRecovery({ tokenId: 3n, proposalHash });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: 'approveRecovery',
        args: [3n, proposalHash],
        reconcileBroadcast: expect.any(Function),
      }),
    );

    await chainService.executeRedemptionRecovery({ tokenId: 3n, proposalHash });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: 'executeRecovery',
        args: [3n, proposalHash],
        reconcileBroadcast: expect.any(Function),
      }),
    );
  });

  it('reconciles a native reserve fund mined after the stored block but before reload', async () => {
    const account = manifest.addresses.Treasury;
    const hash = `0x${'7'.repeat(64)}` as const;
    mocks.readContract.mockResolvedValueOnce(123n);
    await chainService.fundReserve({
      gemId: 6n,
      paymentAsset: zeroAddress,
      amountUsd: usd(50),
    });
    const firstCall = mocks.runContractTransaction.mock.calls.at(-1)?.[0] as {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args: readonly unknown[];
      value: bigint;
      intentKey: string;
      reconcileBroadcast: (
        account: `0x${string}`,
        fromBlock?: bigint,
        expectedOperationKey?: string,
      ) => Promise<`0x${string}` | undefined>;
    };
    const input = encodeFunctionData({
      abi: firstCall.abi,
      functionName: firstCall.functionName,
      args: firstCall.args,
    } as never);
    const storedOperationKey = `${firstCall.address.toLowerCase()}:${input.toLowerCase()}:123`;

    // A changed quote on reload produces a different exact call, but the same
    // semantic intent. Recovery must verify against the persisted first call.
    mocks.readContract.mockResolvedValueOnce(456n);
    await chainService.fundReserve({
      gemId: 6n,
      paymentAsset: zeroAddress,
      amountUsd: usd(50),
    });
    const retryCall = mocks.runContractTransaction.mock.calls.at(-1)?.[0] as typeof firstCall;
    expect(firstCall.intentKey).toBe('fundReserve:6');
    expect(retryCall.intentKey).toBe(firstCall.intentKey);
    expect(retryCall.value).toBe(456n);

    mocks.getLogs.mockResolvedValue([{ transactionHash: hash }]);
    mocks.getTransaction.mockResolvedValueOnce({
      from: manifest.addresses.DGENFT,
      to: firstCall.address,
      input,
      value: 123n,
    });
    await expect(
      retryCall.reconcileBroadcast(account, 44n, storedOperationKey),
    ).resolves.toBeUndefined();

    mocks.getTransaction.mockResolvedValueOnce({
      from: account,
      to: firstCall.address,
      input,
      value: 123n,
    });

    await expect(retryCall.reconcileBroadcast(account, 44n, storedOperationKey)).resolves.toBe(
      hash,
    );
    expect(mocks.getLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ fromBlock: 44n, toBlock: 'latest' }),
    );
    expect(mocks.getTransaction).toHaveBeenLastCalledWith({ hash });
  });

  it('returns a confirmed write even when the background projection never finishes', async () => {
    mocks.syncProjection.mockReturnValue(new Promise(() => undefined));

    await expect(chainService.cancelRedemption({ tokenId: 22n })).resolves.toEqual(txResult);
    expect(mocks.runContractTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'cancelRedemption', args: [22n] }),
    );
  });
});

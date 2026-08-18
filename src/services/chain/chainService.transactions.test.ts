import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zeroAddress, zeroHash } from 'viem';

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  multicall: vi.fn(),
  runContractTransaction: vi.fn(),
  syncProjection: vi.fn(),
}));

vi.mock('@wagmi/core', () => ({
  getAccount: () => ({ address: undefined }),
  getPublicClient: () => ({ readContract: mocks.readContract, multicall: mocks.multicall }),
}));
vi.mock('@/providers/wagmi', () => ({ wagmiConfig: {} }));
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
    requireDeploymentManifest: () => manifest,
  };
});
vi.mock('./transactionPipeline', () => ({
  runContractTransaction: mocks.runContractTransaction,
}));
vi.mock('./projection', () => ({
  syncProjection: mocks.syncProjection,
}));

import { requireDeploymentManifest } from '@/config/contracts';
import { chainService } from './chainService';

const manifest = requireDeploymentManifest();
const usdc = manifest.usdc;
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

beforeEach(() => {
  window.dispatchEvent(new CustomEvent('dc:transaction-confirmed'));
  mocks.readContract.mockReset();
  mocks.multicall.mockReset();
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

describe('chain profile reads', () => {
  it('reports a failed gem-discovery read instead of caching an empty registry', async () => {
    const rpcError = new Error('mobile RPC disconnected');
    mocks.multicall.mockResolvedValue([{ status: 'failure', error: rpcError }]);
    mocks.readContract.mockRejectedValue(rpcError);

    await expect(chainService.getGems()).rejects.toThrow('mobile RPC disconnected');
  });

  it('reports a failed ownership read instead of returning an empty portfolio', async () => {
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

    await expect(chainService.getProfile(owner)).rejects.toThrow('mobile ownerOf request failed');
  });
});

describe('chain transaction construction', () => {
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
  });

  it('constructs both proposer-pays and accepter-pays swap paths', async () => {
    mocks.readContract.mockResolvedValueOnce(musdc(100));
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

  it('constructs redemption, cancellation, and reserve-funding calls', async () => {
    const requestHash = `0x${'2'.repeat(64)}` as const;
    await chainService.requestRedemption({ tokenId: 3n, requestHash });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: manifest.addresses.RedemptionManager,
        functionName: 'requestRedemption',
        args: [3n, requestHash],
      }),
    );

    await chainService.cancelRedemption({ tokenId: 3n });
    expect(mocks.runContractTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        functionName: 'cancelRedemption',
        args: [3n],
      }),
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
});

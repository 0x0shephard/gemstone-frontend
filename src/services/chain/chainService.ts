import { getAccount, getPublicClient } from '@wagmi/core';
import {
  formatUnits,
  isAddress,
  isAddressEqual,
  zeroAddress,
  zeroHash,
  type Abi,
  type Address,
  type Hash,
  type PublicClient,
} from 'viem';
import { wagmiConfig } from '@/providers/wagmi';
import {
  NATIVE_ASSET,
  requireDeploymentManifest,
  type DeploymentManifest,
} from '@/config/contracts';
import { env } from '@/config/env';
import { contracts } from '@/contracts';
import { decorate } from '@/lib/gem';
import type { IDataService, LandingData, ProfileData } from '../IDataService';
import type {
  Auction,
  Bid,
  BidRequest,
  BuyListingRequest,
  BuyNowRequest,
  CancelListingRequest,
  CancelRedemptionRequest,
  ClaimRefundRequest,
  ClaimTreasuryPayoutRequest,
  CreateOfferRequest,
  CreateSwapRequest,
  DecoratedGem,
  FeeTier,
  FundReserveRequest,
  Gem,
  Offer,
  OfferRequest,
  PaymentAsset,
  PendingRefund,
  PendingTreasuryPayout,
  Redemption,
  RedemptionRequest,
  SettleAuctionRequest,
  SwapRequest,
  SwapRequestAction,
  TreasurySplitItem,
  TxResult,
  ListRequest,
  ActivityItem,
} from '../types';
import { discoveredIds, syncProjection, type ProjectionSnapshot } from './projection';
import { runContractTransaction, type Approval } from './transactionPipeline';
import {
  describePaymentAsset,
  formatSwapCash,
  latestBidEventsForAddress,
} from './marketPresentation';

type RegistryGem = readonly [Address, Address, string, Hash, bigint, bigint, Hash, number] & {
  seller: Address;
  custodian: Address;
  metadataURI: string;
  certificateHash: Hash;
  priceUsd: bigint;
  tokenId: bigint;
  redemptionRequestHash: Hash;
  status: number;
};

type Metadata = {
  name?: string;
  type?: string;
  gemstoneType?: string;
  carats?: number;
  caratWeight?: number;
  displayId?: string;
  custodian?: { provider?: string; country?: string };
  custodyProvider?: string;
  custodyCountry?: string;
};

const manifest: DeploymentManifest = requireDeploymentManifest();
const client = getPublicClient(wagmiConfig) as PublicClient;
let projectionPromise: Promise<ProjectionSnapshot> | undefined;
let secondaryFeePctPromise: Promise<number> | undefined;
window.addEventListener('dc:transaction-confirmed', () => {
  projectionPromise = undefined;
});

function contract(moduleName: keyof DeploymentManifest['addresses']) {
  return {
    address: manifest.addresses[moduleName],
    abi: contracts[moduleName].abi as Abi,
  };
}

function projection(force = false): Promise<ProjectionSnapshot> {
  if (force || !projectionPromise) {
    projectionPromise = syncProjection(client).catch((error) => {
      projectionPromise = undefined;
      throw error;
    });
  }
  return projectionPromise;
}

function ipfsUrl(uri: string): string {
  if (!uri.startsWith('ipfs://')) return uri;
  return `${env.ipfsGateway.replace(/\/$/, '')}/${uri.slice('ipfs://'.length).replace(/^ipfs\//, '')}`;
}

async function metadata(uri: string): Promise<Metadata> {
  if (!uri) return {};
  try {
    const response = await fetch(ipfsUrl(uri), { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return {};
    return (await response.json()) as Metadata;
  } catch {
    return {};
  }
}

async function readGem(gemId: bigint): Promise<DecoratedGem | undefined> {
  const registryGem = (await client.readContract({
    ...contract('GemRegistry'),
    functionName: 'getGem',
    args: [gemId],
  })) as RegistryGem;
  if (Number(registryGem.status) === 0 || Number(registryGem.status) === 8) return;

  const connectedAddress = getAccount(wagmiConfig).address;
  const [reserveBalanceUsd, reserveShortfallUsd, requiredReserveUsd, canRedeem, details, feePct] =
    await Promise.all([
      client.readContract({
        ...contract('ReserveManager'),
        functionName: 'reserveBalanceUsd',
        args: [gemId],
      }) as Promise<bigint>,
      client.readContract({
        ...contract('ReserveManager'),
        functionName: 'shortfallUsd',
        args: [gemId, registryGem.priceUsd],
      }) as Promise<bigint>,
      client.readContract({
        ...contract('ReserveManager'),
        functionName: 'requiredReserveUsd',
        args: [gemId, registryGem.priceUsd],
      }) as Promise<bigint>,
      registryGem.tokenId > 0n && connectedAddress
        ? (
            client.readContract({
              ...contract('ComplianceRegistry'),
              functionName: 'canRedeem',
              args: [connectedAddress, registryGem.tokenId],
            }) as Promise<boolean>
          ).catch(() => false)
        : Promise.resolve(false),
      metadata(registryGem.metadataURI),
      (secondaryFeePctPromise ??= (
        client.readContract({
          ...contract('Marketplace'),
          functionName: 'secondaryFeeBps',
        }) as Promise<number>
      ).then((basisPoints) => Number(basisPoints) / 100)),
    ]);

  const gemType = String(details.gemstoneType ?? details.type ?? 'gemstone').toLowerCase();
  const carats = Number(details.caratWeight ?? details.carats ?? 0);
  const reserve =
    requiredReserveUsd === 0n
      ? 100
      : Math.min(100, Number((reserveBalanceUsd * 10_000n) / requiredReserveUsd) / 100);
  const value = Number(formatUnits(registryGem.priceUsd, 18));
  const gem: Gem = {
    gemId,
    tokenId: registryGem.tokenId > 0n ? registryGem.tokenId : undefined,
    displayId: details.displayId ?? `DGE-${gemId}`,
    name:
      details.name ?? `${gemType.replace(/^\w/, (character) => character.toUpperCase())} #${gemId}`,
    type: gemType,
    typeLabel: gemType.replace(/^\w/, (character) => character.toUpperCase()),
    valueUsd: registryGem.priceUsd,
    value,
    carats,
    reserve,
    reserveBalanceUsd,
    reserveShortfallUsd,
    feeTier: 'Secondary marketplace',
    feePct,
    custodyProvider: details.custodian?.provider ?? details.custodyProvider ?? 'Verified custodian',
    custodyCountry: details.custodian?.country ?? details.custodyCountry ?? 'Undisclosed',
    redeem: canRedeem ? 'Eligible' : 'KYC required',
    metadataUri: registryGem.metadataURI,
  };
  return decorate(gem);
}

async function allGems(): Promise<DecoratedGem[]> {
  const snapshot = await projection();
  const ids = discoveredIds(snapshot, 'GemRegistered', 'gemId');
  return (await Promise.all(ids.map((gemId) => readGem(gemId)))).filter(
    (gem): gem is DecoratedGem => Boolean(gem),
  );
}

async function usdToAsset(paymentAsset: Address, usdValue: bigint): Promise<bigint> {
  return (await client.readContract({
    ...contract('PaymentTokenRegistry'),
    functionName: 'quoteUsdToToken',
    args: [paymentAsset, usdValue],
  })) as bigint;
}

function paymentParams(
  paymentAsset: Address,
  amount: bigint,
): {
  paymentAsset: Address;
  paymentAmount: bigint;
  value: bigint | undefined;
  approvals: Approval[];
} {
  return {
    paymentAsset,
    paymentAmount: amount,
    value: paymentAsset === NATIVE_ASSET ? amount : undefined,
    approvals:
      paymentAsset === NATIVE_ASSET
        ? []
        : [
            {
              kind: 'erc20' as const,
              token: paymentAsset,
              spender: zeroAddress,
              amountOrTokenId: amount,
            },
          ],
  };
}

async function getPaymentAssets(): Promise<PaymentAsset[]> {
  const candidates = [
    { address: NATIVE_ASSET, symbol: 'ETH' as const, name: 'Ether', decimals: 18, isNative: true },
    {
      address: manifest.usdc,
      symbol: 'mUSDC',
      name: 'Digital Carat Mock USDC',
      decimals: 6,
      isNative: false,
    },
  ];
  return Promise.all(
    candidates.map(async (asset) => {
      const enabled = (await client.readContract({
        ...contract('PaymentTokenRegistry'),
        functionName: 'isEnabled',
        args: [asset.address],
      })) as boolean;
      if (!enabled) throw new Error(`${asset.symbol} is disabled in PaymentTokenRegistry`);
      const oneToken = 10n ** BigInt(asset.decimals);
      const usdValue = (await client.readContract({
        ...contract('PaymentTokenRegistry'),
        functionName: 'quoteTokenToUsd',
        args: [asset.address, oneToken],
      })) as bigint;
      return {
        ...asset,
        enabled,
        usdPrice: Number(formatUnits(usdValue, 18)),
      };
    }),
  );
}

async function treasurySplit(): Promise<TreasurySplitItem[]> {
  const value = (await client.readContract({
    ...contract('Treasury'),
    functionName: 'splits',
  })) as readonly [number, number, number, number, number];
  const colors = [
    'var(--dc-frost)',
    '#8B8B94',
    'var(--dc-sapphire)',
    'var(--dc-emerald)',
    'var(--dc-ruby)',
  ];
  return ['Seller', 'Platform', 'Vault reserve', 'Insurance reserve', 'Treasury reserve'].map(
    (label, index) => ({ label, pct: `${Number(value[index]) / 100}%`, color: colors[index] }),
  );
}

async function getAuctions(): Promise<Auction[]> {
  const snapshot = await projection();
  const gemIds = discoveredIds(snapshot, 'AuctionCreated', 'gemId');
  const now = BigInt(Math.floor(Date.now() / 1_000));
  const auctions = await Promise.all(
    gemIds.map(async (gemId) => {
      const [state, gem] = await Promise.all([
        client.readContract({
          ...contract('PrimarySaleAuction'),
          functionName: 'auctions',
          args: [gemId],
        }) as Promise<
          readonly [
            boolean,
            boolean,
            bigint,
            bigint,
            bigint,
            Address,
            Address,
            bigint,
            bigint,
            bigint,
          ]
        >,
        readGem(gemId),
      ]);
      if (!gem || !state[0] || state[1]) return;
      return {
        gem,
        highestBidFmt: `$${Number(formatUnits(state[8], 18)).toLocaleString()}`,
        highestBidder: state[5] === zeroAddress ? undefined : state[5],
        bids: snapshot.events.filter(
          (event) =>
            event.module === 'PrimarySaleAuction' &&
            event.eventName === 'BidPlaced' &&
            event.args.gemId === gemId,
        ).length,
        secondsLeft: Number(state[3] > now ? state[3] - now : 0n),
        floorUsd: state[4],
      } satisfies Auction;
    }),
  );
  return auctions.filter(Boolean) as Auction[];
}

async function getListings(): Promise<DecoratedGem[]> {
  const snapshot = await projection();
  const tokenIds = discoveredIds(snapshot, 'Listed', 'tokenId');
  const results = await Promise.all(
    tokenIds.map(async (tokenId) => {
      const listing = (await client.readContract({
        ...contract('Marketplace'),
        functionName: 'listings',
        args: [tokenId],
      })) as readonly [Address, bigint];
      if (listing[0] === zeroAddress) return;
      const gemId = (await client.readContract({
        ...contract('DGENFT'),
        functionName: 'tokenGem',
        args: [tokenId],
      })) as bigint;
      const gem = await readGem(gemId);
      if (!gem) return;
      const value = Number(formatUnits(listing[1], 18));
      return {
        ...gem,
        valueUsd: listing[1],
        value,
        valueFmt: `$${value.toLocaleString('en-US')}`,
      };
    }),
  );
  return results.filter((gem): gem is DecoratedGem => Boolean(gem));
}

async function getOffers(): Promise<Offer[]> {
  const snapshot = await projection();
  const createdEvents = snapshot.events.filter(
    (event) => event.module === 'Marketplace' && event.eventName === 'OfferCreated',
  );
  const now = BigInt(Math.floor(Date.now() / 1_000));
  const offers = await Promise.all(
    [
      ...new Map(
        createdEvents
          .filter((event) => typeof event.args.offerId === 'bigint')
          .map((event) => [String(event.args.offerId), event]),
      ).entries(),
    ].map(async ([id, created]) => {
      const offerId = BigInt(id);
      const state = (await client.readContract({
        ...contract('Marketplace'),
        functionName: 'offers',
        args: [offerId],
      })) as readonly [Address, bigint, Address, bigint, bigint, bigint, boolean];
      const tokenId = state[1] || (created.args.tokenId as bigint);
      const gemId = (await client.readContract({
        ...contract('DGENFT'),
        functionName: 'tokenGem',
        args: [tokenId],
      })) as bigint;
      const gem = await readGem(gemId);
      if (!gem) return;
      const expiry = state[5] || (created.args.expiry as bigint);
      const expired = expiry <= now;
      const terminal = snapshot.events.find(
        (event) =>
          event.module === 'Marketplace' &&
          (event.eventName === 'OfferAccepted' || event.eventName === 'OfferCancelled') &&
          event.args.offerId === offerId,
      );
      const status =
        terminal?.eventName === 'OfferAccepted'
          ? 'Accepted'
          : terminal?.eventName === 'OfferCancelled'
            ? 'Refunded'
            : expired
              ? 'Expired'
              : 'Pending';
      const saleUsdValue = state[4] || (created.args.saleUsdValue as bigint);
      return {
        offerId,
        gem,
        offerFmt: `$${Number(formatUnits(saleUsdValue, 18)).toLocaleString()}`,
        from: state[0] === zeroAddress ? String(created.args.bidder) : state[0],
        status,
        statusColor: status === 'Pending' ? 'var(--dc-amber)' : '#8B8B94',
        secondsLeft: Number(expiry > now ? expiry - now : 0n),
      } satisfies Offer;
    }),
  );
  return offers.filter(Boolean) as Offer[];
}

async function getSwaps(): Promise<SwapRequest[]> {
  const snapshot = await projection();
  const createdEvents = snapshot.events.filter(
    (event) => event.module === 'SwapEscrow' && event.eventName === 'OfferCreated',
  );
  const now = BigInt(Math.floor(Date.now() / 1_000));
  const swaps = await Promise.all(
    [
      ...new Map(
        createdEvents
          .filter((event) => typeof event.args.offerId === 'bigint')
          .map((event) => [String(event.args.offerId), event]),
      ).entries(),
    ].map(async ([id, created]) => {
      const offerId = BigInt(id);
      const state = (await client.readContract({
        ...contract('SwapEscrow'),
        functionName: 'offers',
        args: [offerId],
      })) as readonly [Address, bigint, bigint, Address, bigint, boolean, bigint, boolean];
      const offeredTokenId = state[1] || (created.args.offeredTokenId as bigint);
      const requestedTokenId = state[2] || (created.args.requestedTokenId as bigint);
      const [offeredGemId, requestedGemId] = (await Promise.all([
        client.readContract({
          ...contract('DGENFT'),
          functionName: 'tokenGem',
          args: [offeredTokenId],
        }),
        client.readContract({
          ...contract('DGENFT'),
          functionName: 'tokenGem',
          args: [requestedTokenId],
        }),
      ])) as [bigint, bigint];
      const [offered, requested] = await Promise.all([
        readGem(offeredGemId),
        readGem(requestedGemId),
      ]);
      if (!offered || !requested) return;
      const expiry = state[6] || (created.args.expiry as bigint);
      const expired = expiry <= now;
      const terminal = snapshot.events.find(
        (event) =>
          event.module === 'SwapEscrow' &&
          (event.eventName === 'OfferAccepted' || event.eventName === 'OfferCancelled') &&
          event.args.offerId === offerId,
      );
      const status =
        terminal?.eventName === 'OfferAccepted'
          ? 'Accepted'
          : terminal?.eventName === 'OfferCancelled'
            ? 'Cancelled'
            : expired
              ? 'Expired'
              : 'Active';
      const cashAmount = state[4] || (created.args.cashAmount as bigint);
      const proposerPays = state[7] ? state[5] : (created.args.proposerPaysCash as boolean);
      const cashAsset = state[3] || (created.args.cashAsset as Address);
      const cashDescriptor = describePaymentAsset(cashAsset, manifest.usdc);
      const cashUsd =
        cashAmount === 0n
          ? 0n
          : ((await client.readContract({
              ...contract('PaymentTokenRegistry'),
              functionName: 'quoteTokenToUsd',
              args: [cashAsset, cashAmount],
            })) as bigint);
      return {
        offerId,
        gem: requested,
        offeredTokenId,
        requestedTokenId,
        giveName: offered.name,
        giveDisplayId: offered.displayId,
        diff: formatSwapCash(cashAmount, cashUsd, cashDescriptor, proposerPays),
        status,
        statusColor: status === 'Active' ? 'var(--dc-amber)' : '#8B8B94',
      } satisfies SwapRequest;
    }),
  );
  return swaps.filter(Boolean) as SwapRequest[];
}

async function getRedemptions(): Promise<Redemption[]> {
  const snapshot = await projection();
  const active = new Map<bigint, { gemId: bigint; requestHash: Hash }>();
  for (const event of snapshot.events) {
    if (event.module !== 'RedemptionManager') continue;
    const tokenId = event.args.tokenId;
    const gemId = event.args.gemId;
    if (typeof tokenId !== 'bigint' || typeof gemId !== 'bigint') continue;
    if (event.eventName === 'RedemptionOpened' && typeof event.args.requestHash === 'string') {
      active.set(tokenId, { gemId, requestHash: event.args.requestHash as Hash });
    }
    if (event.eventName === 'RedemptionCancelled' || event.eventName === 'RedemptionConfirmed') {
      active.delete(tokenId);
    }
  }
  const results = await Promise.all(
    [...active.entries()].map(async ([tokenId, opened]) => {
      const gem = await readGem(opened.gemId);
      if (!gem) return;
      return {
        workflowId: `onchain-${opened.requestHash}`,
        tokenId,
        gem,
        stage: 'Custodian fulfillment',
        progress: 60,
        status: 'On-chain request open',
        statusColor: 'var(--dc-amber)',
      } satisfies Redemption;
    }),
  );
  return results.filter(Boolean) as Redemption[];
}

function activityFor(snapshot: ProjectionSnapshot, address?: string): ActivityItem[] {
  if (!address) return [];
  const normalized = address.toLowerCase();
  return snapshot.events
    .filter((event) =>
      Object.values(event.args).some(
        (value) => typeof value === 'string' && value.toLowerCase() === normalized,
      ),
    )
    .slice(-50)
    .reverse()
    .map((event) => ({
      kind: event.eventName.replace(/([a-z])([A-Z])/g, '$1 $2'),
      gem: event.module,
      displayId:
        typeof event.args.gemId === 'bigint'
          ? `DGE-${event.args.gemId}`
          : typeof event.args.tokenId === 'bigint'
            ? `Token #${event.args.tokenId}`
            : 'Protocol',
      amount:
        typeof event.args.usdValue === 'bigint'
          ? `$${Number(formatUnits(event.args.usdValue, 18)).toLocaleString()}`
          : '—',
      date: `Block ${event.blockNumber}`,
      color: event.finalized ? 'var(--dc-emerald)' : 'var(--dc-amber)',
      txHash: event.transactionHash,
    }));
}

async function refresh(): Promise<void> {
  await projection(true);
}

export const chainService: IDataService = {
  getGems: allGems,
  getGem: readGem,
  getListings,
  getAuctions,
  getAuction: async (gemId) => (await getAuctions()).find((auction) => auction.gem.gemId === gemId),
  getOffers,
  getSwapRequests: getSwaps,
  getRedemptions,
  getProfile: async (address): Promise<ProfileData> => {
    const gems = await allGems();
    const owned = address
      ? (
          await Promise.all(
            gems.map(async (gem) => {
              if (!gem.tokenId) return;
              const owner = (await client
                .readContract({
                  ...contract('DGENFT'),
                  functionName: 'ownerOf',
                  args: [gem.tokenId],
                })
                .catch(() => zeroAddress)) as Address;
              return isAddressEqual(owner, address as Address) ? gem : undefined;
            }),
          )
        ).filter((gem): gem is DecoratedGem => Boolean(gem))
      : [];
    const snapshot = await projection();
    const bidEvents = latestBidEventsForAddress(snapshot.events, address);
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const bids = (
      await Promise.all(
        bidEvents.map(async (event) => {
          const gemId = event.args.gemId as bigint;
          const [gem, auction] = await Promise.all([
            readGem(gemId),
            client.readContract({
              ...contract('PrimarySaleAuction'),
              functionName: 'auctions',
              args: [gemId],
            }) as Promise<
              readonly [
                boolean,
                boolean,
                bigint,
                bigint,
                bigint,
                Address,
                Address,
                bigint,
                bigint,
                bigint,
              ]
            >,
          ]);
          if (!gem || !auction[0]) return;
          const mine = event.args.usdValue as bigint;
          const secondsLeft = Number(auction[3] > now ? auction[3] - now : 0n);
          const leading =
            Boolean(address) &&
            auction[5] !== zeroAddress &&
            isAddressEqual(auction[5], address as Address);
          return {
            gem,
            myBidFmt: `$${Number(formatUnits(mine, 18)).toLocaleString()}`,
            topBidFmt: `$${Number(formatUnits(auction[8], 18)).toLocaleString()}`,
            status: leading ? ('Leading' as const) : ('Outbid' as const),
            statusColor: leading ? 'var(--dc-emerald)' : 'var(--dc-amber)',
            secondsLeft,
          };
        }),
      )
    ).filter((bid): bid is Bid => Boolean(bid));
    return {
      owned,
      bids,
      offers: await getOffers(),
      swaps: await getSwaps(),
      redemptions: await getRedemptions(),
      activity: activityFor(snapshot, address),
      stats: {
        portfolioValueUsd: owned.reduce((sum, gem) => sum + gem.value, 0),
        ownedCount: owned.length,
        activeBids: bids.filter((bid) => bid.secondsLeft > 0).length,
        reserveShortfallUsd: owned.reduce(
          (sum, gem) => sum + Number(formatUnits(gem.reserveShortfallUsd, 18)),
          0,
        ),
      },
    };
  },
  getLanding: async (): Promise<LandingData> => {
    const [gems, auctions, split] = await Promise.all([allGems(), getAuctions(), treasurySplit()]);
    return {
      featured: gems.slice(0, 3),
      auctions,
      trustSignals: [
        {
          title: 'Custody verified',
          sub: 'Contract lifecycle attestation',
          color: 'var(--dc-emerald)',
        },
        {
          title: 'Reserve funded',
          sub: 'On-chain backing per gem',
          color: 'var(--dc-sapphire)',
        },
        { title: 'Expert approved', sub: 'No automated valuation', color: 'var(--dc-frost)' },
        {
          title: 'Redeemable asset',
          sub: 'Compliance-gated release',
          color: 'var(--dc-ruby)',
        },
      ],
      howSteps: [],
      treasurySplit: split,
      gemsInVault: gems.length,
      featuredCaption: gems[0]?.displayId ?? 'No registered gems',
    };
  },
  getFeeTiers: async (): Promise<FeeTier[]> => {
    const count = (await client.readContract({
      ...contract('ReserveManager'),
      functionName: 'reserveBracketCount',
    })) as bigint;
    const brackets = await Promise.all(
      Array.from({ length: Number(count) }, (_, index) =>
        client.readContract({
          ...contract('ReserveManager'),
          functionName: 'reserveBracket',
          args: [BigInt(index)],
        }),
      ),
    );
    const maxUint256 = (1n << 256n) - 1n;
    const usdLabel = (value: bigint) =>
      `$${Number(formatUnits(value, 18)).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

    return brackets.map((raw, index) => {
      const bracket = raw as readonly [bigint, bigint, number];
      const [minimum, maximum, reserveBps] = bracket;
      const range =
        maximum === maxUint256
          ? `${usdLabel(minimum)} and above`
          : minimum === 0n
            ? `Under ${usdLabel(maximum)}`
            : `${usdLabel(minimum)} – ${usdLabel(maximum)}`;
      return {
        tier: `Reserve ${index + 1}`,
        range,
        pct: `${Number(reserveBps) / 100}%`,
      };
    });
  },
  getPaymentAssets,
  getPendingAuctionRefunds: async (address?: string): Promise<PendingRefund[]> => {
    if (!address || !isAddress(address)) return [];
    const assets = await getPaymentAssets();
    const refunds = await Promise.all(
      assets.map(async (asset) => {
        const amount = (await client.readContract({
          ...contract('PrimarySaleAuction'),
          functionName: 'pendingRefunds',
          args: [address, asset.address],
        })) as bigint;
        if (amount === 0n) return;
        return {
          paymentAsset: asset.address,
          symbol: asset.symbol,
          amount,
          amountFmt: `${Number(formatUnits(amount, asset.decimals)).toLocaleString('en-US', {
            maximumFractionDigits: asset.decimals,
          })} ${asset.symbol}`,
        };
      }),
    );
    return refunds.filter((refund): refund is PendingRefund => Boolean(refund));
  },
  getPendingTreasuryPayout: async (
    address?: string,
  ): Promise<PendingTreasuryPayout | undefined> => {
    if (!address || !isAddress(address)) return;
    const amount = (await client.readContract({
      ...contract('Treasury'),
      functionName: 'pendingNative',
      args: [address],
    })) as bigint;
    if (amount === 0n) return;
    return {
      amount,
      amountFmt: `${Number(formatUnits(amount, 18)).toLocaleString('en-US', {
        maximumFractionDigits: 6,
      })} ETH`,
    };
  },

  buyNow: async (request: BuyNowRequest): Promise<TxResult> => {
    const gem = (await client.readContract({
      ...contract('GemRegistry'),
      functionName: 'getGem',
      args: [request.gemId],
    })) as RegistryGem;
    const shortfall = (await client.readContract({
      ...contract('ReserveManager'),
      functionName: 'shortfallUsd',
      args: [request.gemId, gem.priceUsd],
    })) as bigint;
    const amount =
      request.maximumAmount ?? (await usdToAsset(request.paymentAsset, gem.priceUsd + shortfall));
    const params = paymentParams(request.paymentAsset, amount);
    if (params.approvals[0]) params.approvals[0].spender = manifest.addresses.PrimarySaleAuction;
    const result = await runContractTransaction({
      ...contract('PrimarySaleAuction'),
      functionName: 'buyNow',
      args: [request.gemId, request.paymentAsset, amount],
      ...params,
    });
    await refresh();
    return result;
  },
  buy: async (request: BuyListingRequest): Promise<TxResult> => {
    const listing = (await client.readContract({
      ...contract('Marketplace'),
      functionName: 'listings',
      args: [request.tokenId],
    })) as readonly [Address, bigint];
    const gemId = (await client.readContract({
      ...contract('DGENFT'),
      functionName: 'tokenGem',
      args: [request.tokenId],
    })) as bigint;
    const gem = (await client.readContract({
      ...contract('GemRegistry'),
      functionName: 'getGem',
      args: [gemId],
    })) as RegistryGem;
    const shortfall = (await client.readContract({
      ...contract('ReserveManager'),
      functionName: 'shortfallUsd',
      args: [gemId, gem.priceUsd],
    })) as bigint;
    const amount =
      request.maximumAmount ?? (await usdToAsset(request.paymentAsset, listing[1] + shortfall));
    const params = paymentParams(request.paymentAsset, amount);
    if (params.approvals[0]) params.approvals[0].spender = manifest.addresses.Marketplace;
    const result = await runContractTransaction({
      ...contract('Marketplace'),
      functionName: 'buy',
      args: [request.tokenId, request.paymentAsset, amount],
      ...params,
    });
    await refresh();
    return result;
  },
  list: async (request: ListRequest): Promise<TxResult> =>
    runContractTransaction({
      ...contract('Marketplace'),
      functionName: 'list',
      args: [request.tokenId, request.priceUsd],
      approvals: [
        {
          kind: 'erc721',
          token: manifest.addresses.DGENFT,
          spender: manifest.addresses.Marketplace,
          amountOrTokenId: request.tokenId,
        },
      ],
    }),
  cancelListing: (request: CancelListingRequest) =>
    runContractTransaction({
      ...contract('Marketplace'),
      functionName: 'cancel',
      args: [request.tokenId],
    }),
  bid: async (request: BidRequest) => {
    const amount = await usdToAsset(request.paymentAsset, request.amountUsd);
    const params = paymentParams(request.paymentAsset, amount);
    if (params.approvals[0]) params.approvals[0].spender = manifest.addresses.PrimarySaleAuction;
    return runContractTransaction({
      ...contract('PrimarySaleAuction'),
      functionName: 'bid',
      args: [request.gemId, request.paymentAsset, amount],
      ...params,
    });
  },
  settleAuction: (request: SettleAuctionRequest) =>
    runContractTransaction({
      ...contract('PrimarySaleAuction'),
      functionName: 'settleAuction',
      args: [request.gemId],
    }),
  claimRefund: (request: ClaimRefundRequest) =>
    runContractTransaction({
      ...contract('PrimarySaleAuction'),
      functionName: 'claimRefund',
      args: [request.paymentAsset],
    }),
  claimTreasuryPayout: (request: ClaimTreasuryPayoutRequest) =>
    runContractTransaction({
      ...contract('Treasury'),
      functionName: 'claimNative',
      args: [request.recipient],
    }),
  createOffer: async (request: CreateOfferRequest) => {
    const amount = await usdToAsset(request.paymentAsset, request.amountUsd);
    const params = paymentParams(request.paymentAsset, amount);
    if (params.approvals[0]) params.approvals[0].spender = manifest.addresses.Marketplace;
    return runContractTransaction({
      ...contract('Marketplace'),
      functionName: 'createOffer',
      args: [request.tokenId, request.paymentAsset, amount],
      ...params,
    });
  },
  acceptOffer: async (request: OfferRequest) => {
    const offer = (await client.readContract({
      ...contract('Marketplace'),
      functionName: 'offers',
      args: [request.offerId],
    })) as readonly [Address, bigint, Address, bigint, bigint, bigint, boolean];
    return runContractTransaction({
      ...contract('Marketplace'),
      functionName: 'acceptOffer',
      args: [request.offerId],
      approvals: [
        {
          kind: 'erc721',
          token: manifest.addresses.DGENFT,
          spender: manifest.addresses.Marketplace,
          amountOrTokenId: offer[1],
        },
      ],
    });
  },
  refundExpiredOffer: (request: OfferRequest) =>
    runContractTransaction({
      ...contract('Marketplace'),
      functionName: 'cancelExpiredOffer',
      args: [request.offerId],
    }),
  createSwap: async (request: CreateSwapRequest) => {
    const cashAmount =
      request.cashAmountUsd === 0n
        ? 0n
        : await usdToAsset(request.paymentAsset, request.cashAmountUsd);
    const approvals: Approval[] = [
      {
        kind: 'erc721' as const,
        token: manifest.addresses.DGENFT,
        spender: manifest.addresses.SwapEscrow,
        amountOrTokenId: request.offeredTokenId,
      },
    ];
    if (request.proposerPays && request.paymentAsset !== NATIVE_ASSET && cashAmount > 0n) {
      approvals.push({
        kind: 'erc20' as const,
        token: request.paymentAsset,
        spender: manifest.addresses.SwapEscrow,
        amountOrTokenId: cashAmount,
      });
    }
    return runContractTransaction({
      ...contract('SwapEscrow'),
      functionName: 'createOffer',
      args: [
        request.offeredTokenId,
        request.requestedTokenId,
        request.paymentAsset,
        cashAmount,
        request.proposerPays,
        request.expiresAt,
      ],
      paymentAsset: request.proposerPays ? request.paymentAsset : undefined,
      paymentAmount: request.proposerPays ? cashAmount : undefined,
      value: request.proposerPays && request.paymentAsset === NATIVE_ASSET ? cashAmount : undefined,
      approvals,
    });
  },
  acceptSwap: async (request: SwapRequestAction) => {
    const offer = (await client.readContract({
      ...contract('SwapEscrow'),
      functionName: 'offers',
      args: [request.offerId],
    })) as readonly [Address, bigint, bigint, Address, bigint, boolean, bigint, boolean];
    const approvals: Approval[] = [
      {
        kind: 'erc721' as const,
        token: manifest.addresses.DGENFT,
        spender: manifest.addresses.SwapEscrow,
        amountOrTokenId: offer[2],
      },
    ];
    if (!offer[5] && offer[3] !== NATIVE_ASSET && offer[4] > 0n) {
      approvals.push({
        kind: 'erc20' as const,
        token: offer[3],
        spender: manifest.addresses.SwapEscrow,
        amountOrTokenId: offer[4],
      });
    }
    return runContractTransaction({
      ...contract('SwapEscrow'),
      functionName: 'acceptOffer',
      args: [request.offerId],
      paymentAsset: offer[5] ? undefined : offer[3],
      paymentAmount: offer[5] ? undefined : offer[4],
      value: !offer[5] && offer[3] === NATIVE_ASSET ? offer[4] : undefined,
      approvals,
    });
  },
  cancelSwap: (request: SwapRequestAction) =>
    runContractTransaction({
      ...contract('SwapEscrow'),
      functionName: 'cancelOffer',
      args: [request.offerId],
    }),
  requestRedemption: (request: RedemptionRequest) => {
    if (request.requestHash === zeroHash) {
      throw new Error('A server-generated redemption commitment is required');
    }
    return runContractTransaction({
      ...contract('RedemptionManager'),
      functionName: 'requestRedemption',
      args: [request.tokenId, request.requestHash],
    });
  },
  cancelRedemption: (request: CancelRedemptionRequest) =>
    runContractTransaction({
      ...contract('RedemptionManager'),
      functionName: 'cancelRedemption',
      args: [request.tokenId],
    }),
  fundReserve: async (request: FundReserveRequest) => {
    const amount = await usdToAsset(request.paymentAsset, request.amountUsd);
    if (request.paymentAsset === NATIVE_ASSET) {
      return runContractTransaction({
        ...contract('ReserveManager'),
        functionName: 'fundNative',
        args: [request.gemId],
        value: amount,
        paymentAsset: request.paymentAsset,
        paymentAmount: amount,
      });
    }
    return runContractTransaction({
      ...contract('ReserveManager'),
      functionName: 'fundToken',
      args: [request.gemId, request.paymentAsset, amount],
      paymentAsset: request.paymentAsset,
      paymentAmount: amount,
      approvals: [
        {
          kind: 'erc20',
          token: request.paymentAsset,
          spender: manifest.addresses.ReserveManager,
          amountOrTokenId: amount,
        },
      ],
    });
  },
};

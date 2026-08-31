import { getAccount, getPublicClient } from '@wagmi/core';
import {
  BaseError,
  ContractFunctionRevertedError,
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
import { projectionLogClients, wagmiConfig } from '@/providers/wagmi';
import {
  NATIVE_ASSET,
  requireDeploymentManifest,
  type DeploymentManifest,
} from '@/config/contracts';
import { env } from '@/config/env';
import { activeChain } from '@/config/chains';
import { ownershipPathSteps } from '@/content/ownershipPath';
import { contracts } from '@/contracts';
import { decorate } from '@/lib/gem';
import type { IDataService, LandingData, ProfileData } from '../IDataService';
import type {
  ApproveTransferRequest,
  Auction,
  Bid,
  BidRequest,
  BuyListingRequest,
  BuyNowRequest,
  CancelListingRequest,
  CancelRedemptionRequest,
  ConfirmRedemptionRequest,
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
  RevokeApprovalRequest,
  SettleAuctionRequest,
  SwapRequest,
  SwapRequestAction,
  TransferTokenRequest,
  TreasurySplitItem,
  TxResult,
  ListRequest,
  ActivityItem,
} from '../types';
import { syncProjection, type ProjectionSnapshot } from './projection';
import { readMetadata, trait } from './metadata';
import { gatewayUrl, resolveIpfsGateways } from '@/config/ipfs';
import {
  runContractTransaction,
  TransactionGuardError,
  type Approval,
} from './transactionPipeline';
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

const manifest: DeploymentManifest = requireDeploymentManifest();
/*
 * Pinned to the chain the app targets, never to the one the wallet happens to be
 * on. `getPublicClient` without a chain follows the connection, which was
 * harmless only while a single chain was configured — the moment another was
 * added so a wrong network could be detected, every read from a wallet sitting
 * on mainnet went to mainnet, where none of these contracts exist. The portfolio
 * then reported an empty wallet rather than an unreachable one.
 *
 * Reads describe the protocol, which lives in exactly one place. Only writes care
 * where the wallet is, and `ensureChain` moves it there first.
 */
const client = getPublicClient(wagmiConfig, { chainId: activeChain.id }) as PublicClient;
let projectionPromise: Promise<ProjectionSnapshot> | undefined;
let settledSnapshot: ProjectionSnapshot | undefined;
let gemIdsPromise: Promise<bigint[]> | undefined;
let secondaryFeePctPromise: Promise<number> | undefined;
window.addEventListener('dc:transaction-confirmed', () => {
  projectionPromise = undefined;
  gemIdsPromise = undefined;
});

function contract(moduleName: keyof DeploymentManifest['addresses']) {
  return {
    address: manifest.addresses[moduleName],
    abi: contracts[moduleName].abi as Abi,
  };
}

/**
 * How long a settled projection is reused before being rebuilt.
 *
 * The cache was invalidated only by `dc:transaction-confirmed`, which fires for
 * transactions made *here*. Everything the rest of the world does — an offer
 * arriving, a swap proposed, a gem registered — was therefore invisible until
 * the tab was reloaded or the visitor happened to transact, and the queries
 * layered on top refetched a snapshot that could not change.
 *
 * Short enough that the market looks live, long enough that the many callers of
 * `projection()` inside one render do not each trigger a replay.
 */
const PROJECTION_TTL_MS = 45_000;
let projectionFetchedAt = 0;

function projection(force = false): Promise<ProjectionSnapshot> {
  if (!force && projectionPromise && Date.now() - projectionFetchedAt > PROJECTION_TTL_MS) {
    projectionPromise = undefined;
    // Discovery is bounded by the same clock: a gem registered by someone else
    // is new state too, and probing for it is what makes it appear at all.
    gemIdsPromise = undefined;
  }
  if (force || !projectionPromise) {
    projectionFetchedAt = Date.now();
    projectionPromise = syncProjection(client, { logClients: projectionLogClients })
      .then((snapshot) => {
        settledSnapshot = snapshot;
        /*
         * `syncProjection` announces `synced` before returning. Consumers that
         * refetch on that event can therefore run one tick too early and still
         * see no settled snapshot. Announce readiness only after publishing it.
         */
        window.dispatchEvent(new CustomEvent('dc:chain-snapshot-ready'));
        return snapshot;
      })
      .catch((error) => {
        projectionPromise = undefined;
        throw error;
      });
  }
  return projectionPromise;
}

/**
 * Event history for views that must not wait on it. Starts the sync if it is not
 * already running and returns whatever has settled, so first paint renders from
 * contract state while the log replay continues behind it. Consumers refetch when
 * `dc:chain-sync` reports the sync finished.
 */
function settledEvents(): ProjectionSnapshot['events'] {
  void projection().catch(() => undefined);
  return settledSnapshot?.events ?? [];
}

const GEM_PROBE_WINDOW = 25;
const GEM_PROBE_LIMIT = 5_000;

/** Only the registry's explicit end-of-sequence error means an id is absent. */
function isInvalidGem(error: unknown): boolean {
  if (error instanceof BaseError) {
    const reverted = error.walk(
      (candidate) => candidate instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError | null;
    if (reverted?.data?.errorName === 'InvalidGem') return true;
  }
  // Some RPCs return a decoded custom-error name without viem's nested cause.
  return error instanceof Error && /\bInvalidGem\b/.test(error.message);
}

/**
 * `GemRegistry` exposes no enumeration and keeps `_nextGemId` private, but ids are
 * sequential from 1 and registered gems are never removed, so the live set can be
 * probed directly. `getGem` reverts `InvalidGem` past the last id, which ends the
 * walk. This keeps gem discovery off the event projection entirely.
 */
async function discoverGemIds(): Promise<bigint[]> {
  const ids: bigint[] = [];
  for (let start = 1; start <= GEM_PROBE_LIMIT; start += GEM_PROBE_WINDOW) {
    const window = Array.from({ length: GEM_PROBE_WINDOW }, (_, index) => BigInt(start + index));
    const results = await client.multicall({
      contracts: window.map((gemId) => ({
        ...contract('GemRegistry'),
        functionName: 'getGem',
        args: [gemId],
      })),
      allowFailure: true,
    });
    const firstFailure = results.findIndex((result) => result.status !== 'success');
    if (firstFailure === -1) {
      ids.push(...window);
      continue;
    }

    ids.push(...window.slice(0, firstFailure));

    /*
     * `allowFailure` reports both a real `InvalidGem` and a transient RPC failure
     * as the same failed slot. Treating either one as the end of the registry made
     * a flaky mobile read cache an empty id list and therefore a convincing empty
     * portfolio. Verify the remainder directly: only `InvalidGem` ends discovery;
     * transport, rate-limit and decoding failures must reach React Query's error
     * state so the user can retry them.
     */
    for (const gemId of window.slice(firstFailure)) {
      try {
        await readRegistryGem(gemId);
        ids.push(gemId);
      } catch (error) {
        if (isInvalidGem(error)) return ids;
        throw error;
      }
    }
  }
  return ids;
}

function gemIds(): Promise<bigint[]> {
  gemIdsPromise ??= discoverGemIds().catch((error) => {
    gemIdsPromise = undefined;
    throw error;
  });
  return gemIdsPromise;
}

const preferredGateway = resolveIpfsGateways(env.ipfsGateway)[0];

/**
 * Images render through the preferred gateway only. Unlike the metadata document
 * an `<img>` cannot be retried across gateways in-band, so `GemThumb` falls back
 * to the generated swatch if the fetch fails.
 */
function imageUrl(image?: string): string | undefined {
  return image ? gatewayUrl(preferredGateway, image) : undefined;
}

async function readRegistryGem(gemId: bigint): Promise<RegistryGem> {
  return (await client.readContract({
    ...contract('GemRegistry'),
    functionName: 'getGem',
    args: [gemId],
  })) as RegistryGem;
}

async function readGem(gemId: bigint): Promise<DecoratedGem | undefined> {
  const registryGem = await readRegistryGem(gemId);
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
              args: [connectedAddress],
            }) as Promise<boolean>
          ).catch(() => false)
        : Promise.resolve(false),
      readMetadata(registryGem.metadataURI),
      (secondaryFeePctPromise ??= (
        client.readContract({
          ...contract('Marketplace'),
          functionName: 'secondaryFeeBps',
        }) as Promise<number>
      ).then((basisPoints) => Number(basisPoints) / 100)),
    ]);

  // Standard `attributes` first, then the flat keys used by gems registered before
  // the standard shape. Their metadata URIs are immutable, so both paths persist.
  const gemType = String(
    trait(details, 'Gem Type') ?? details.gemstoneType ?? details.type ?? 'gemstone',
  ).toLowerCase();
  const carats = Number(
    trait(details, 'Carat Weight') ?? details.caratWeight ?? details.carats ?? 0,
  );
  const reserve =
    requiredReserveUsd === 0n
      ? 100
      : Math.min(100, Number((reserveBalanceUsd * 10_000n) / requiredReserveUsd) / 100);
  const value = Number(formatUnits(registryGem.priceUsd, 18));

  /*
   * Ownership and listing state travel with every gem, so a caller never has to
   * infer them from the URL. `GemDetailPage` previously decided between Buy and
   * Make an offer from a `?market=` query parameter, which is a guess about the
   * chain rather than a reading of it.
   */
  let owner: Address | undefined;
  let listingSeller: Address | undefined;
  let listedPriceUsd: bigint | undefined;
  if (registryGem.tokenId > 0n) {
    /*
     * A failed ownership read is unknown ownership, never "no owner". Swallowing
     * this error let `getProfile` report zero tokens even though the NFT existed.
     * Redeemed gems are filtered by registry status above, before this call.
     */
    owner = (await client.readContract({
      ...contract('DGENFT'),
      functionName: 'ownerOf',
      args: [registryGem.tokenId],
    })) as Address;
    const listing = (await client
      .readContract({
        ...contract('Marketplace'),
        functionName: 'listings',
        args: [registryGem.tokenId],
      })
      .catch(() => undefined)) as readonly [Address, bigint] | undefined;
    if (listing && listing[0] !== zeroAddress) {
      listingSeller = listing[0];
      listedPriceUsd = listing[1];
    }
  }

  const gem: Gem = {
    gemId,
    tokenId: registryGem.tokenId > 0n ? registryGem.tokenId : undefined,
    owner,
    /*
     * The ask, never the valuation. This block previously overwrote `valueUsd`
     * and `value` — and then the approved figures were assigned again further
     * down the same object literal, so the listed price was computed and
     * discarded on every read. Listing a token changed nothing visible, which
     * is exactly what it looked like from the outside: nothing happening.
     */
    ...(listingSeller
      ? {
          market: 'secondary' as const,
          listingSeller,
          listedPriceUsd,
          listedPrice: Number(formatUnits(listedPriceUsd!, 18)),
        }
      : {}),
    displayId: trait(details, 'Display ID') ?? details.displayId ?? `DGE-${gemId}`,
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
    custodyProvider:
      trait(details, 'Custodian') ??
      details.custodian?.provider ??
      details.custodyProvider ??
      'Verified custodian',
    custodyCountry:
      trait(details, 'Custody Country') ??
      details.custodian?.country ??
      details.custodyCountry ??
      'Undisclosed',
    /*
     * `canRedeem` is false for exactly one reason once redemption approval mode
     * is off: the address is on the compliance block list. Labelling that "KYC
     * required" told people to go and verify themselves, which would not have
     * helped and is no longer what the gate checks.
     */
    redeem: canRedeem ? 'Eligible' : 'Blocked',
    metadataUri: registryGem.metadataURI,
    image: imageUrl(details.image),
  };
  return decorate(gem);
}

async function allGems(): Promise<DecoratedGem[]> {
  const ids = await gemIds();
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
      const enabled = (await client
        .readContract({
          ...contract('PaymentTokenRegistry'),
          functionName: 'isEnabled',
          args: [asset.address],
        })
        .catch(() => false)) as boolean;
      /*
       * Reported, not thrown.
       *
       * This runs inside a `Promise.all`, so throwing on a disabled asset
       * rejected the whole list and left every payment screen unable to offer
       * *any* asset — one token being turned off in the registry took down
       * buying, bidding, offers, swaps and reserve funding together. The type
       * has carried an `enabled` flag all along, which is the shape that lets a
       * caller drop one asset and keep the other.
       *
       * A disabled asset has no meaningful quote either, and asking for one can
       * revert, so the price read is skipped rather than guarded downstream.
       */
      const oneToken = 10n ** BigInt(asset.decimals);
      const usdValue = enabled
        ? ((await client
            .readContract({
              ...contract('PaymentTokenRegistry'),
              functionName: 'quoteTokenToUsd',
              args: [asset.address, oneToken],
            })
            .catch(() => 0n)) as bigint)
        : 0n;
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

type AuctionState = readonly [
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
];

async function getAuctions(): Promise<Auction[]> {
  const ids = await gemIds();
  const now = BigInt(Math.floor(Date.now() / 1_000));
  // Auction records are read straight from contract state, so a gem with a live
  // auction appears without waiting for its `AuctionCreated` log to be replayed.
  const states = (await Promise.all(
    ids.map((gemId) =>
      client.readContract({
        ...contract('PrimarySaleAuction'),
        functionName: 'auctions',
        args: [gemId],
      }),
    ),
  )) as AuctionState[];
  const live = ids
    .map((gemId, index) => ({ gemId, state: states[index] }))
    .filter(({ state }) => state[0] && !state[1]);
  // Bid counts are historical and have no contract-state equivalent, so they fill
  // in once the projection settles rather than gating the auction list.
  const events = settledEvents();
  const auctions = await Promise.all(
    live.map(async ({ gemId, state }) => {
      const gem = await readGem(gemId);
      if (!gem) return;
      return {
        gem,
        highestBidFmt: `$${Number(formatUnits(state[8], 18)).toLocaleString()}`,
        highestBidder: state[5] === zeroAddress ? undefined : state[5],
        bids: events.filter(
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

/**
 * Every token that currently exists, listed for sale or not.
 *
 * The marketplace is a catalogue rather than a for-sale list: a gemstone becomes
 * a token only by being won at auction, so every token has an owner, and hiding
 * the unlisted ones would hide most of the collection. Unminted stones do not
 * belong here at all — they live in the auction, which is the only way to mint.
 *
 * A token burned by redemption is dropped by `readGem` from its terminal registry
 * status. An ownership read failure is allowed to reject the query; it must not be
 * presented as evidence that the token does not exist.
 */
async function getListings(): Promise<DecoratedGem[]> {
  const ids = await gemIds();
  const gems = await Promise.all(ids.map((gemId) => readGem(gemId)));
  // `readGem` resolves ownership and listing state, and returns no owner for a
  // token whose NFT was burned by redemption.
  return gems.filter((gem): gem is DecoratedGem => Boolean(gem?.owner));
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
      const bidder =
        state[0] === zeroAddress ? (created.args.bidder as Address) : (state[0] as Address);
      const gemId = (await client.readContract({
        ...contract('DGENFT'),
        functionName: 'tokenGem',
        args: [tokenId],
      })) as bigint;
      const gem = await readGem(gemId);
      if (!gem) return;
      const [tokenOwner, listing] = await Promise.all([
        client
          .readContract({
            ...contract('DGENFT'),
            functionName: 'ownerOf',
            args: [tokenId],
          })
          .catch(() => zeroAddress) as Promise<Address>,
        client.readContract({
          ...contract('Marketplace'),
          functionName: 'listings',
          args: [tokenId],
        }) as Promise<readonly [Address, bigint]>,
      ]);
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
        bidder,
        tokenOwner,
        listingSeller: listing[0] === zeroAddress ? undefined : listing[0],
        offerFmt: `$${Number(formatUnits(saleUsdValue, 18)).toLocaleString()}`,
        from: bidder,
        status,
        /*
         * Expired reads as amber, not grey. It is the state where the bidder's
         * payment is still held by the contract and only they can retrieve it,
         * so it wants attention rather than the muted tone of a closed row.
         */
        statusColor: status === 'Pending' || status === 'Expired' ? 'var(--dc-amber)' : '#8B8B94',
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
      const [offered, requested, requestedOwner] = await Promise.all([
        readGem(offeredGemId),
        readGem(requestedGemId),
        client
          .readContract({
            ...contract('DGENFT'),
            functionName: 'ownerOf',
            args: [requestedTokenId],
          })
          .catch(() => zeroAddress) as Promise<Address>,
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
        proposer:
          state[0] === zeroAddress ? (created.args.proposer as Address) : (state[0] as Address),
        requestedOwner,
        offeredTokenId,
        requestedTokenId,
        giveName: offered.name,
        giveDisplayId: offered.displayId,
        diff: formatSwapCash(cashAmount, cashUsd, cashDescriptor, proposerPays),
        status,
        // As with offers: an expired swap still holds the proposer's token in
        // escrow, so it is unfinished business rather than history.
        statusColor: status === 'Active' || status === 'Expired' ? 'var(--dc-amber)' : '#8B8B94',
      } satisfies SwapRequest;
    }),
  );
  return swaps.filter(Boolean) as SwapRequest[];
}

async function getRedemptions(): Promise<Redemption[]> {
  const snapshot = await projection();
  const active = new Map<bigint, { gemId: bigint; requestHash: Hash; owner: Address }>();
  for (const event of snapshot.events) {
    if (event.module !== 'RedemptionManager') continue;
    const tokenId = event.args.tokenId;
    const gemId = event.args.gemId;
    if (typeof tokenId !== 'bigint' || typeof gemId !== 'bigint') continue;
    if (
      event.eventName === 'RedemptionOpened' &&
      typeof event.args.requestHash === 'string' &&
      typeof event.args.owner === 'string'
    ) {
      active.set(tokenId, {
        gemId,
        requestHash: event.args.requestHash as Hash,
        owner: event.args.owner as Address,
      });
    }
    if (event.eventName === 'RedemptionCancelled' || event.eventName === 'RedemptionConfirmed') {
      active.delete(tokenId);
    }
  }
  const results = await Promise.all(
    [...active.entries()].map(async ([tokenId, opened]) => {
      const [gem, registryGem] = await Promise.all([
        readGem(opened.gemId),
        readRegistryGem(opened.gemId).catch(() => undefined),
      ]);
      if (!gem || !registryGem) return;
      return {
        workflowId: `onchain-${opened.requestHash}`,
        tokenId,
        gem,
        owner: opened.owner,
        custodian: registryGem.custodian,
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
    /*
     * `allGems` already resolves current ownership and listing state. Calling
     * `getListings` beside it repeated every registry, reserve, metadata and
     * `ownerOf` read, doubling the chance that a phone's transient RPC failure
     * would sink the portfolio. Reuse the same authoritative snapshot instead.
     */
    const gems = await allGems();
    const listings = gems.filter((gem) => Boolean(gem.owner));
    const walletOwned = address
      ? gems.filter((gem) => gem.owner && isAddressEqual(gem.owner, address as Address))
      : [];
    const escrowedListings = address
      ? listings.filter(
          (gem) =>
            gem.market === 'secondary' &&
            gem.listingSeller &&
            isAddressEqual(gem.listingSeller, address as Address),
        )
      : [];
    const owned = [
      ...new Map(
        [...walletOwned, ...escrowedListings].map((gem) => [gem.gemId.toString(), gem]),
      ).values(),
    ];
    const ownedStats = {
      portfolioValueUsd: owned.reduce((sum, gem) => sum + gem.value, 0),
      ownedCount: owned.length,
      reserveShortfallUsd: owned.reduce(
        (sum, gem) => sum + Number(formatUnits(gem.reserveShortfallUsd, 18)),
        0,
      ),
    };

    /*
     * Ownership is live contract state and is already complete at this point.
     * Event projection supplies bids, offers, swaps, redemptions and history, but
     * a cold phone may need minutes to replay it. Waiting here withheld a known
     * holding and left the always-mounted KPI cards showing their fallback zeros,
     * which looked exactly like a successful empty portfolio.
     *
     * Return the authoritative holding immediately. The background projection
     * emits `dc:chain-snapshot-ready` after publishing its snapshot, which
     * invalidates this query and fills the event-backed tabs on the next pass.
     */
    const snapshot = settledSnapshot;
    if (!snapshot) {
      void projection().catch(() => undefined);
      return {
        owned,
        bids: [],
        offers: [],
        swaps: [],
        redemptions: [],
        activity: [],
        stats: { ...ownedStats, activeBids: 0 },
      };
    }
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
          /*
           * A settled auction is finished business, win or lose.
           *
           * Only `exists` was checked, so a bid stayed in the list for good once
           * the auction closed — reading "Leading · Ended" beside a token that
           * was already sitting in the portfolio. Settlement is the moment there
           * is nothing left to do: the winner has the token, and a loser's stake
           * is a claimable refund shown on the auctions page.
           *
           * An auction that has ended but is *not* yet settled stays, because
           * the sweep has still to act on it.
           */
          if (!gem || !auction[0] || auction[1]) return;
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
    const [offers, swaps, redemptions] = await Promise.all([
      getOffers(),
      getSwaps(),
      getRedemptions(),
    ]);
    const normalizedAddress = address?.toLowerCase();
    return {
      owned,
      bids,
      /*
       * Live offers only.
       *
       * `getOffers` replays every `OfferCreated` the protocol has ever emitted,
       * so an offer that was accepted or refunded stayed in the list for good.
       * These tabs are a to-do list — the tab even carries a count — and one
       * that never empties stops being read. Settled offers are not lost: every
       * one of these events already appears under History.
       *
       * `Expired` is deliberately kept. It means the offer lapsed and the
       * payment is *still* sitting in the Marketplace contract waiting to be
       * claimed, which is the most actionable row on the screen. Only
       * `Refunded` — the claim having actually happened — retires it.
       */
      offers: normalizedAddress
        ? offers.filter(
            (offer) =>
              (offer.status === 'Pending' || offer.status === 'Expired') &&
              (offer.bidder.toLowerCase() === normalizedAddress ||
                offer.tokenOwner.toLowerCase() === normalizedAddress ||
                offer.listingSeller?.toLowerCase() === normalizedAddress),
          )
        : [],
      // Same shape, same reason. An expired swap still holds the proposer's NFT
      // in escrow until they cancel, so it stays; a cancelled or accepted one is
      // finished with.
      swaps: normalizedAddress
        ? swaps.filter(
            (swap) =>
              (swap.status === 'Active' || swap.status === 'Expired') &&
              (swap.proposer.toLowerCase() === normalizedAddress ||
                swap.requestedOwner.toLowerCase() === normalizedAddress),
          )
        : [],
      /*
       * Both sides of the redemption, not just the owner's.
       *
       * The custodian is the only address that can confirm one, and filtering
       * to the owner meant the party who has to act never saw that there was
       * anything to act on — which is why a request could sit open indefinitely
       * with the portal cheerfully reporting "in progress".
       */
      redemptions: normalizedAddress
        ? redemptions.filter(
            (redemption) =>
              redemption.owner.toLowerCase() === normalizedAddress ||
              redemption.custodian.toLowerCase() === normalizedAddress,
          )
        : [],
      activity: activityFor(snapshot, address),
      stats: {
        ...ownedStats,
        activeBids: bids.filter((bid) => bid.secondsLeft > 0).length,
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
      howSteps: [...ownershipPathSteps],
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
      /*
       * viem decodes a Solidity struct as an object keyed by the ABI field
       * names. Treating it as a tuple worked in TypeScript only because of the
       * assertion above; at runtime the object was not iterable and every fee
       * tier request failed.
       */
      const bracket = raw as {
        minPriceUsd: bigint;
        maxPriceUsd: bigint;
        reserveBps: number;
      };
      const minimum = bracket.minPriceUsd;
      const maximum = bracket.maxPriceUsd;
      const reserveBps = bracket.reserveBps;
      const range =
        maximum === maxUint256
          ? `${usdLabel(minimum)} and above`
          : minimum === 0n
            ? `Under ${usdLabel(maximum)}`
            : `${usdLabel(minimum)} - ${usdLabel(maximum)}`;
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
  // Both refresh: a listing changes ownership to the Marketplace escrow and adds
  // an ask, and neither shows up until the gem is re-read.
  list: async (request: ListRequest): Promise<TxResult> => {
    const result = await runContractTransaction({
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
    });
    await refresh();
    return result;
  },
  cancelListing: async (request: CancelListingRequest): Promise<TxResult> => {
    const result = await runContractTransaction({
      ...contract('Marketplace'),
      functionName: 'cancel',
      args: [request.tokenId],
    });
    await refresh();
    return result;
  },
  getTokenApprovals: async (tokenIds: bigint[]): Promise<Record<string, Address>> => {
    const approvals = await Promise.all(
      tokenIds.map(
        (tokenId) =>
          client
            .readContract({
              ...contract('DGENFT'),
              functionName: 'getApproved',
              args: [tokenId],
            })
            // A burned or never-minted id reverts. Reporting "nothing approved"
            // is both true and the answer that makes the caller do nothing.
            .catch(() => zeroAddress) as Promise<Address>,
      ),
    );
    return Object.fromEntries(
      tokenIds.map((tokenId, index) => [tokenId.toString(), approvals[index]]),
    );
  },
  transferToken: async (request: TransferTokenRequest): Promise<TxResult> => {
    /*
     * `from` is read rather than assumed. A listed token is owned by the
     * Marketplace escrow, not by the seller, and passing the connected wallet
     * would produce an `ERC721IncorrectOwner` revert that says nothing useful.
     */
    const [owner, locked] = (await Promise.all([
      client.readContract({
        ...contract('DGENFT'),
        functionName: 'ownerOf',
        args: [request.tokenId],
      }),
      client.readContract({
        ...contract('DGENFT'),
        functionName: 'transferLocked',
        args: [request.tokenId],
      }),
    ])) as [Address, boolean];

    if (locked) {
      throw new Error(
        'This token is locked while its redemption is in progress. Cancel the redemption to transfer it.',
      );
    }
    if (isAddressEqual(owner, manifest.addresses.Marketplace)) {
      throw new Error('This token is escrowed by an active listing. Cancel the listing first.');
    }

    const result = await runContractTransaction({
      ...contract('DGENFT'),
      functionName: 'safeTransferFrom',
      args: [owner, request.to, request.tokenId],
    });
    await refresh();
    return result;
  },
  approveTransfer: (request: ApproveTransferRequest) =>
    runContractTransaction({
      ...contract('DGENFT'),
      functionName: 'approve',
      args: [request.operator, request.tokenId],
    }),
  /** Clears a standing approval by approving the zero address. */
  revokeApproval: (request: RevokeApprovalRequest) =>
    runContractTransaction({
      ...contract('DGENFT'),
      functionName: 'approve',
      args: [zeroAddress, request.tokenId],
    }),
  bid: async (request: BidRequest) => {
    const gem = await readRegistryGem(request.gemId);
    const shortfall = (await client.readContract({
      ...contract('ReserveManager'),
      functionName: 'shortfallUsd',
      args: [request.gemId, gem.priceUsd],
    })) as bigint;
    const amount = await usdToAsset(request.paymentAsset, request.saleAmountUsd + shortfall);
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
    const gemId = (await client.readContract({
      ...contract('DGENFT'),
      functionName: 'tokenGem',
      args: [request.tokenId],
    })) as bigint;
    const gem = await readRegistryGem(gemId);
    const shortfall = (await client.readContract({
      ...contract('ReserveManager'),
      functionName: 'shortfallUsd',
      args: [gemId, gem.priceUsd],
    })) as bigint;
    const amount = await usdToAsset(request.paymentAsset, request.saleAmountUsd + shortfall);
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
    if (!offer[7]) {
      throw new TransactionGuardError(
        'This swap is no longer open. Refresh the list to see its current state.',
        'CONTRACT_REVERTED',
      );
    }
    const [latestBlock, requestedOwner] = await Promise.all([
      client.getBlock(),
      client.readContract({
        ...contract('DGENFT'),
        functionName: 'ownerOf',
        args: [offer[2]],
      }) as Promise<Address>,
    ]);
    if (offer[6] <= latestBlock.timestamp) {
      throw new TransactionGuardError(
        'This swap has expired. Ask the proposer to cancel it and create a new one.',
        'CONTRACT_REVERTED',
      );
    }
    const connected = getAccount(wagmiConfig).address;
    if (connected && !isAddressEqual(connected, requestedOwner)) {
      throw new TransactionGuardError(
        `Connect the wallet that owns requested token #${offer[2].toString()} to accept this swap.`,
        'WRONG_WALLET',
      );
    }
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
  /*
   * The last step, and the only one nothing else can do for you. It burns the
   * token, marks the gem redeemed and releases the reserve to the custodian —
   * irreversible, and callable only by the address recorded as custodian on the
   * gem.
   */
  confirmRedemption: (request: ConfirmRedemptionRequest) =>
    runContractTransaction({
      ...contract('RedemptionManager'),
      functionName: 'confirmRedemption',
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

import { formatUnits, type Address } from 'viem';
import { NATIVE_ASSET } from '@/config/contracts';
import type { ProjectedEvent } from './projection';
import type { Auction, PaymentAsset, SwapRequest } from '../types';

export interface AssetDescriptor {
  symbol: string;
  decimals: number;
}

export function describePaymentAsset(
  asset: Address,
  knownAssets: readonly PaymentAsset[] = [],
): AssetDescriptor {
  const known = knownAssets.find(
    (candidate) => candidate.address.toLowerCase() === asset.toLowerCase(),
  );
  if (known) return { symbol: known.symbol, decimals: known.decimals };
  if (asset === NATIVE_ASSET) return { symbol: 'ETH', decimals: 18 };
  return { symbol: 'token', decimals: 18 };
}

export function formatSwapCash(
  amount: bigint,
  usdValue: bigint,
  descriptor: AssetDescriptor,
  proposerPays: boolean,
): string {
  if (amount === 0n) return 'No cash delta';
  return `${proposerPays ? 'Proposer pays' : 'Accepter pays'} ${formatUnits(
    amount,
    descriptor.decimals,
  )} ${descriptor.symbol} ($${Number(formatUnits(usdValue, 18)).toLocaleString()})`;
}

/**
 * Wallets with a standing bid on a primary auction: each bidder counts once,
 * and a bidder whose latest action was cancelling is not counted. Re-bidding
 * after being outbid is the same bidder, not another bid.
 */
export function auctionBidCount(events: ProjectedEvent[], gemId: bigint): number {
  const standing = new Map<string, boolean>();
  for (const event of events) {
    if (event.module !== 'PrimarySaleAuction' || event.args.gemId !== gemId) continue;
    if (typeof event.args.bidder !== 'string') continue;
    const bidder = event.args.bidder.toLowerCase();
    if (event.eventName === 'BidPlaced') standing.set(bidder, true);
    if (event.eventName === 'BidCancelled') standing.set(bidder, false);
  }
  return [...standing.values()].filter(Boolean).length;
}

export function latestBidEventsForAddress(
  events: ProjectedEvent[],
  address?: string,
): ProjectedEvent[] {
  if (!address) return [];
  const normalized = address.toLowerCase();
  const latestByGem = new Map<string, ProjectedEvent>();
  for (const event of events) {
    if (
      event.module !== 'PrimarySaleAuction' ||
      (event.eventName !== 'BidPlaced' && event.eventName !== 'BidCancelled') ||
      typeof event.args.bidder !== 'string' ||
      event.args.bidder.toLowerCase() !== normalized ||
      typeof event.args.gemId !== 'bigint'
    ) {
      continue;
    }
    // A withdrawn bid is no longer the account's bid; a later BidPlaced revives it.
    if (event.eventName === 'BidCancelled') latestByGem.delete(String(event.args.gemId));
    else latestByGem.set(String(event.args.gemId), event);
  }
  return [...latestByGem.values()];
}

export function groupAuctions(auctions: Auction[]) {
  return {
    live: auctions.filter((auction) => !auction.settled && auction.secondsLeft > 0),
    awaitingSettlement: auctions.filter((auction) => !auction.settled && auction.secondsLeft <= 0),
    past: auctions.filter((auction) => auction.settled),
  };
}

/**
 * Keeps the open board honest without stranding escrowed gemstones.
 *
 * Accepted and cancelled records are history, not open requests. An expired
 * offer is different: the contract still holds the proposer's offered NFT until
 * they cancel it, so only that proposer should see it in the cleanup queue.
 *
 * A live offer whose requested gemstone has since entered redemption can never
 * be accepted (the token is transfer-locked), so it is not an open request
 * either. Its proposer still has a token in escrow and needs to cancel it.
 */
export function groupActionableSwaps(swaps: SwapRequest[], viewer?: string) {
  const normalized = viewer?.toLowerCase();
  const ownedByViewer = (swap: SwapRequest) =>
    Boolean(normalized) && swap.proposer.toLowerCase() === normalized;
  const redeeming = (swap: SwapRequest) => swap.gem.transferLocked === true;
  return {
    active: swaps.filter((swap) => swap.status === 'Active' && !redeeming(swap)),
    expiredOwned: swaps.filter((swap) => swap.status === 'Expired' && ownedByViewer(swap)),
    blockedOwned: swaps.filter(
      (swap) => swap.status === 'Active' && redeeming(swap) && ownedByViewer(swap),
    ),
  };
}

/** Tokens still economically held by a proposer while SwapEscrow has custody. */
export function escrowedSwapTokenIds(swaps: SwapRequest[], viewer?: string): Set<string> {
  const normalized = viewer?.toLowerCase();
  if (!normalized) return new Set();
  return new Set(
    swaps
      .filter(
        (swap) =>
          (swap.status === 'Active' || swap.status === 'Expired') &&
          swap.proposer.toLowerCase() === normalized,
      )
      .map((swap) => swap.offeredTokenId.toString()),
  );
}

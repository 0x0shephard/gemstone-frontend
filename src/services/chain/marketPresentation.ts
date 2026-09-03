import { formatUnits, type Address } from 'viem';
import { NATIVE_ASSET } from '@/config/contracts';
import type { ProjectedEvent } from './projection';
import type { Auction, SwapRequest } from '../types';

export interface AssetDescriptor {
  symbol: string;
  decimals: number;
}

export function describePaymentAsset(asset: Address, mockUsdc: Address): AssetDescriptor {
  if (asset === NATIVE_ASSET) return { symbol: 'ETH', decimals: 18 };
  if (asset.toLowerCase() === mockUsdc.toLowerCase()) return { symbol: 'mUSDC', decimals: 6 };
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
      event.eventName !== 'BidPlaced' ||
      typeof event.args.bidder !== 'string' ||
      event.args.bidder.toLowerCase() !== normalized ||
      typeof event.args.gemId !== 'bigint'
    ) {
      continue;
    }
    latestByGem.set(String(event.args.gemId), event);
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
 */
export function groupActionableSwaps(swaps: SwapRequest[], viewer?: string) {
  const normalized = viewer?.toLowerCase();
  return {
    active: swaps.filter((swap) => swap.status === 'Active'),
    expiredOwned: normalized
      ? swaps.filter(
          (swap) => swap.status === 'Expired' && swap.proposer.toLowerCase() === normalized,
        )
      : [],
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

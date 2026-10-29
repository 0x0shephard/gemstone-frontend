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

/** `usdValue` is undefined when the cash asset could not be quoted; the token amount still stands. */
export function formatSwapCash(
  amount: bigint,
  usdValue: bigint | undefined,
  descriptor: AssetDescriptor,
  proposerPays: boolean,
): string {
  if (amount === 0n) return 'No cash delta';
  const usd =
    usdValue === undefined
      ? 'USD value unavailable'
      : `$${Number(formatUnits(usdValue, 18)).toLocaleString()}`;
  return `${proposerPays ? 'Proposer pays' : 'Accepter pays'} ${formatUnits(
    amount,
    descriptor.decimals,
  )} ${descriptor.symbol} (${usd})`;
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

/**
 * Auctions by what can happen to them next.
 *
 * Only an ended auction with a leading bid is awaiting settlement:
 * `PrimarySaleAuction.settleAuction` reverts `InvalidAuction` when nobody bid,
 * so offering "Settle" there (and counting it as pending) promised an action
 * that could only fail. An ended auction without a bid waits for the lister to
 * open a new round instead.
 */
export function groupAuctions(auctions: Auction[]) {
  const ended = (auction: Auction) => !auction.settled && auction.secondsLeft <= 0;
  return {
    live: auctions.filter((auction) => !auction.settled && auction.secondsLeft > 0),
    awaitingSettlement: auctions.filter((auction) => ended(auction) && auction.highestBidder),
    endedWithoutBids: auctions.filter((auction) => ended(auction) && !auction.highestBidder),
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

/**
 * The account on the requested side of a swap.
 *
 * `requestedOwner` is a live `ownerOf` read, so once a swap is accepted it names
 * the proposer (who now holds the requested token) and the counterparty drops
 * out of their own completed swap. The accepter recorded by the event is the
 * counterparty from then on.
 */
export function swapCounterparty(
  swap: Pick<SwapRequest, 'status' | 'requestedOwner' | 'accepter'>,
) {
  return swap.status === 'Accepted' && swap.accepter ? swap.accepter : swap.requestedOwner;
}

/** Whether the viewer is either party to the swap. */
export function isSwapParty(
  swap: Pick<SwapRequest, 'status' | 'proposer' | 'requestedOwner' | 'accepter'>,
  viewer?: string,
): boolean {
  const normalized = viewer?.toLowerCase();
  if (!normalized) return false;
  return (
    swap.proposer.toLowerCase() === normalized ||
    swapCounterparty(swap).toLowerCase() === normalized ||
    swap.requestedOwner.toLowerCase() === normalized
  );
}

/**
 * The viewer's swaps for the portfolio, split the way its tab counts them.
 *
 * `open` (still holding a token in escrow) is what the tab's count reports;
 * `closed` is the record of accepted and cancelled swaps, shown to both
 * parties beneath it.
 */
export function portfolioSwaps(swaps: SwapRequest[], viewer?: string) {
  const mine = swaps.filter((swap) => isSwapParty(swap, viewer));
  return {
    open: mine.filter((swap) => swap.status === 'Active' || swap.status === 'Expired'),
    closed: mine.filter((swap) => swap.status === 'Accepted' || swap.status === 'Cancelled'),
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

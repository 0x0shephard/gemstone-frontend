import type { Address } from 'viem';
import type { Auction, Gem, SwapRequest } from '@/services/types';
import { inGiftEscrow } from './gem';

/**
 * What the gem page should offer, decided from chain state alone.
 *
 * Each case is one set of buttons. The page previously chose them from two
 * guesses: "Place bid" for any stone without a token (`isAuction =
 * !gem.tokenId`), and owner actions whenever `?manage=1` was in the URL. The
 * first offered bids on stones with no auction, or whose auction had closed;
 * the second showed List and Send to anyone who followed a portfolio link.
 */
export type GemPageMode =
  /** RedemptionManager has locked the token; nothing can move it. */
  | { kind: 'locked'; owner: boolean }
  /** The viewer listed it; the Marketplace holds it. */
  | { kind: 'owner-listing'; listingAuction: ListingAuctionState }
  /** The viewer holds it in their wallet. */
  | { kind: 'owner-wallet' }
  /** The viewer's token is escrowed by their own swap proposal. */
  | { kind: 'owner-swap-escrow'; swap?: SwapRequest }
  /** A primary auction is open for bids. */
  | { kind: 'primary-bid'; auction: Auction }
  /** A primary auction exists but has not opened yet. */
  | { kind: 'primary-upcoming'; auction: Auction }
  /** The primary auction ended with a leading bid and can be settled by anyone. */
  | { kind: 'primary-settle'; auction: Auction }
  /** The primary auction ended without a bid; nothing to settle. */
  | { kind: 'primary-unsold'; auction: Auction }
  /** Not a token yet and no auction is open (or auction state is still loading). */
  | { kind: 'primary-unavailable'; loading: boolean }
  /** Someone else's token on a Marketplace listing. */
  | { kind: 'listing'; listingAuction: ListingAuctionState }
  /** Someone else's token held in a contract escrow; offers there could never be accepted. */
  | { kind: 'escrowed' }
  /** Someone else's unlisted token in their wallet. */
  | { kind: 'held' };

/** A listing's automatic auction: none yet, running, or past its end awaiting settlement. */
export type ListingAuctionState = 'none' | 'live' | 'ended';

export interface GemPageContext {
  viewer?: Address | string;
  /** The primary auction record for this gem, when read. */
  auction?: Auction;
  /** Whether primary auctions are still loading. */
  auctionsLoading?: boolean;
  /** All known swaps, used to recognise the viewer's own escrowed token. */
  swaps?: readonly SwapRequest[];
  custody: { marketplace?: Address; swapEscrow?: Address; giftOperator?: Address };
  /** Unix seconds; injectable for tests. */
  now?: bigint;
}

const same = (left?: string, right?: string) =>
  Boolean(left && right && left.toLowerCase() === right.toLowerCase());

export function listingAuctionState(
  gem: Pick<Gem, 'listingWinningOfferId' | 'listingAuctionEnd'>,
  now: bigint,
): ListingAuctionState {
  if (!gem.listingWinningOfferId) return 'none';
  // `Marketplace.createOffer` reverts `Expired` once the end has passed, and
  // `settleListingAuction` accepts it from that second on.
  return gem.listingAuctionEnd !== undefined && now >= gem.listingAuctionEnd ? 'ended' : 'live';
}

export function gemPageMode(
  gem: Pick<
    Gem,
    | 'gemId'
    | 'tokenId'
    | 'owner'
    | 'listingSeller'
    | 'listingWinningOfferId'
    | 'listingAuctionEnd'
    | 'transferLocked'
    | 'escrowDepositor'
    | 'giftEscrowed'
  >,
  context: GemPageContext,
): GemPageMode {
  const now = context.now ?? BigInt(Math.floor(Date.now() / 1_000));
  const { viewer, custody } = context;

  if (!gem.tokenId) {
    const auction = context.auction;
    if (!auction || auction.settled) {
      return { kind: 'primary-unavailable', loading: Boolean(context.auctionsLoading && !auction) };
    }
    if (now < auction.startTime) return { kind: 'primary-upcoming', auction };
    if (now < auction.endTime) return { kind: 'primary-bid', auction };
    return auction.highestBidder
      ? { kind: 'primary-settle', auction }
      : { kind: 'primary-unsold', auction };
  }

  const listedByViewer = same(gem.listingSeller, viewer);
  const heldByViewer = same(gem.owner, viewer);
  const inSwapEscrow = same(gem.owner, custody.swapEscrow);
  // A swap escrows the proposer's token, so `ownerOf` names SwapEscrow. The
  // proposer still owns it economically and is the only one who can cancel.
  const ownSwap = inSwapEscrow
    ? context.swaps?.find(
        (swap) =>
          swap.offeredTokenId === gem.tokenId &&
          (swap.status === 'Active' || swap.status === 'Expired') &&
          same(swap.proposer, viewer),
      )
    : undefined;
  const ownedByViewer = listedByViewer || heldByViewer || Boolean(ownSwap);

  if (gem.transferLocked) return { kind: 'locked', owner: ownedByViewer };
  if (listedByViewer) {
    return { kind: 'owner-listing', listingAuction: listingAuctionState(gem, now) };
  }
  if (ownSwap) return { kind: 'owner-swap-escrow', swap: ownSwap };
  if (heldByViewer) return { kind: 'owner-wallet' };
  if (gem.listingSeller) return { kind: 'listing', listingAuction: listingAuctionState(gem, now) };
  if (
    inSwapEscrow ||
    same(gem.owner, custody.marketplace) ||
    inGiftEscrow(gem, custody.giftOperator)
  ) {
    return { kind: 'escrowed' };
  }
  return { kind: 'held' };
}

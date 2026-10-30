/**
 * Rules for the seller route "mint to my wallet" (docs/seller-mint-design.md).
 *
 * Pure, so the edge functions and their tests share one definition of when a
 * stone may switch from auction to minting and how a sale mode is encoded.
 */

export type SaleMode = 'buy_now' | 'auction' | 'seller_mint';

/** `GemRegistry.PrimarySaleMode` ordinals. SellerMint was appended last. */
export const PRIMARY_SALE_MODE = { none: 0, buyNow: 1, auction: 2, sellerMint: 3 } as const;

export function saleModeCode(mode: SaleMode): number {
  if (mode === 'auction') return PRIMARY_SALE_MODE.auction;
  if (mode === 'seller_mint') return PRIMARY_SALE_MODE.sellerMint;
  return PRIMARY_SALE_MODE.buyNow;
}

/** What a seller may ask for at submission. Buy-now is never offered. */
export function requestedSaleMode(value: unknown): 'auction' | 'seller_mint' {
  return value === 'seller_mint' ? 'seller_mint' : 'auction';
}

export interface AuctionState {
  exists: boolean;
  settled: boolean;
  endTime: bigint;
  highestBidder: string;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Why an auction stone may not switch to minting yet, or null when it may.
 *
 * A seller may switch once a round has ended without a sale. The sweep reopens
 * an unbid round straight away, so "ended" is either the current round being
 * past its end with no leader, or the sweep having already reopened at least
 * one round (`reopenedRounds > 0`) while nobody leads the current one. A live
 * leader always blocks: their bid is binding and the auction must run its
 * course.
 */
export function sellerMintSwitchBlocker(input: {
  auction: AuctionState;
  nowSeconds: bigint;
  reopenedRounds: number;
}): string | null {
  const { auction, nowSeconds, reopenedRounds } = input;
  if (!auction.exists || auction.settled) return null;
  if (auction.highestBidder.toLowerCase() !== ZERO_ADDRESS) {
    return 'This auction has a live bid. It must run its course before you can mint instead.';
  }
  if (auction.endTime <= nowSeconds || reopenedRounds > 0) return null;
  return 'You can mint to your wallet once this first auction round ends without a bid.';
}

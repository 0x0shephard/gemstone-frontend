import { formatUnits } from 'viem';
import { ceilMulDiv } from './units';

/**
 * Price headroom for fixed-price purchases, in basis points (0.5%).
 *
 * `Marketplace.buy` and `PrimarySaleAuction.buyNow` re-quote the price inside
 * the transaction, revert when the payment falls short and refund any surplus
 * to the buyer in the same transaction. Sending the exact quote meant a single
 * oracle tick between the quote and inclusion reverted the purchase
 * (`PriceNotMet` / `BidTooLow`); sending a little more costs nothing, because
 * whatever is not needed comes straight back.
 */
export const PURCHASE_SLIPPAGE_BPS = 50n;

/**
 * Headroom suggested above a bid's minimum, in basis points (0.5%).
 *
 * Unlike a purchase, a bid's escrow *is* the bid: the contract keeps all of it
 * and credits its full USD value, so nothing is added silently. The headroom is
 * only ever a suggestion the bidder can see and edit.
 */
export const BID_HEADROOM_BPS = 50n;

const BPS = 10_000n;
/** One US cent in 18-decimal USD. */
const CENT = 10n ** 16n;

/** The purchase amount to send: the quote plus {@link PURCHASE_SLIPPAGE_BPS}, rounded up. */
export function withPurchaseHeadroom(quotedAmount: bigint): bigint {
  return quotedAmount + ceilMulDiv(quotedAmount, PURCHASE_SLIPPAGE_BPS, BPS);
}

/**
 * The bid to suggest for an 18-decimal USD minimum: the minimum plus
 * {@link BID_HEADROOM_BPS}, rounded up to a whole cent so it reads cleanly.
 */
export function suggestedBidUsd(minimumUsd: bigint): bigint {
  if (minimumUsd <= 0n) return minimumUsd;
  const buffered = minimumUsd + ceilMulDiv(minimumUsd, BID_HEADROOM_BPS, BPS);
  return ceilMulDiv(buffered, 1n, CENT) * CENT;
}

/** Whether a bid sits inside the headroom band, where a small price move can reject it. */
export function bidWithinHeadroom(bidUsd: bigint, minimumUsd: bigint): boolean {
  return bidUsd >= minimumUsd && bidUsd < suggestedBidUsd(minimumUsd);
}

/** An 18-decimal USD amount as a plain input string ("1005.25", never "1,005.25"). */
export function usdInputString(value: bigint): string {
  const formatted = formatUnits(value, 18);
  const [whole, fraction] = formatted.split('.');
  return fraction ? `${whole}.${fraction.slice(0, 2).padEnd(2, '0')}` : whole;
}

/** The headroom as a human percentage ("0.5%"). */
export function headroomPercent(bps: bigint): string {
  return `${Number(bps) / 100}%`;
}

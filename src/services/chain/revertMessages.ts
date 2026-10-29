import { decodeErrorResult, type Abi, type Hex } from 'viem';
import { paymentTokenRegistryAbi, reserveManagerAbi } from '@/contracts/abis';

/**
 * Errors raised by contracts the transaction did not call directly.
 *
 * Every priced action quotes through `PaymentTokenRegistry`, and bids, purchases
 * and offers ask `ReserveManager` for solvency first. Their custom errors are
 * not in the ABI of the contract the wallet called, so viem cannot decode them
 * and hands back a bare four-byte selector, which used to reach the UI as
 * "Contract transaction reverted" — the one message that explains nothing.
 */
const FOREIGN_ERROR_ABI = [
  ...(paymentTokenRegistryAbi as Abi),
  ...(reserveManagerAbi as Abi),
].filter((item) => item.type === 'error') as Abi;

export interface DecodedRevert {
  errorName: string;
  args: readonly unknown[];
}

/** Decodes raw revert data against the registry and reserve-manager errors. */
export function decodeForeignRevert(raw: Hex | undefined): DecodedRevert | undefined {
  if (!raw || raw === '0x' || raw.length < 10) return;
  try {
    const decoded = decodeErrorResult({ abi: FOREIGN_ERROR_ABI, data: raw });
    return { errorName: decoded.errorName, args: (decoded.args ?? []) as readonly unknown[] };
  } catch {
    return;
  }
}

const NO_PAYMENT_TAKEN = 'No payment was taken.';

/**
 * A sentence a person can act on for a named contract error, or undefined when
 * the name has no better wording than itself.
 *
 * `functionName` disambiguates errors that mean different things on different
 * calls: `BidTooLow` from `buyNow` is a price move on a fixed-price sale, from
 * `bid` it is a bid under the minimum, and `InvalidPrice` from `list` is the
 * seller's ask while from anything else it is the oracle.
 */
export function describeRevert(errorName: string, functionName?: string): string | undefined {
  switch (errorName) {
    case 'StalePrice':
      return `The price feed for this payment asset has not updated recently, so it is paused for safety. Try again shortly or pay with another asset. ${NO_PAYMENT_TAKEN}`;
    case 'InvalidPrice':
      return functionName === 'list'
        ? 'That asking price is not allowed. Choose a price above zero and within the listing limit.'
        : `The price feed for this payment asset returned a price outside its safe range, so it is paused. Try another asset or try again later. ${NO_PAYMENT_TAKEN}`;
    case 'InvalidFeed':
      return `This payment asset has no working price feed. Choose another asset. ${NO_PAYMENT_TAKEN}`;
    case 'TokenNotEnabled':
      return `This payment asset is not accepted right now. Choose another asset. ${NO_PAYMENT_TAKEN}`;
    case 'SequencerDown':
    case 'SequencerGracePeriodNotOver':
      return `The network is recovering from an outage, so prices are paused for safety. Try again in about an hour. ${NO_PAYMENT_TAKEN}`;
    case 'Insolvent':
    case 'UnderfundedReserves':
      return 'Protocol reserves are briefly below full coverage, so bids, purchases, offers and new redemptions are paused. Try again once Digital Carat restores coverage.';
    case 'EnforcedPause':
      return `This contract is paused by Digital Carat, so the action cannot run right now. ${NO_PAYMENT_TAKEN}`;
    case 'BidTooLow':
      if (functionName === 'buyNow') {
        return `The price moved before your purchase confirmed, so the payment fell short. Try again; the app sends a small buffer and the contract refunds anything unused. ${NO_PAYMENT_TAKEN}`;
      }
      return `Your bid is below the current minimum. Someone may have outbid you, or the payment asset's price moved since the quote. Refresh, then bid at least the new minimum, ideally a little above it. ${NO_PAYMENT_TAKEN}`;
    case 'PriceNotMet':
      if (functionName === 'buy') {
        return `The price moved before your purchase confirmed, so the payment fell short. Try again; the app sends a small buffer and the contract refunds anything unused. ${NO_PAYMENT_TAKEN}`;
      }
      if (functionName === 'acceptOffer') {
        return 'At the current price, the bidder’s escrow no longer covers this offer, so it cannot be accepted. The bidder can withdraw it, or you can wait for the price to recover.';
      }
      return `At the current price, this amount does not cover the offer plus any reserve top-up. Raise it a little and try again. ${NO_PAYMENT_TAKEN}`;
    case 'AuctionEnded':
      return `This auction has ended, so it no longer takes bids. If it has a winning bid, it can be settled now. ${NO_PAYMENT_TAKEN}`;
    case 'InvalidAuction':
      if (functionName === 'settleAuction') {
        return 'This auction cannot be settled: it has already been settled, or it ended without a bid.';
      }
      if (functionName === 'cancelBid') return 'There is no open bid to withdraw on this auction.';
      return `This auction is not taking bids: it has not started, has already been settled, or was cancelled. ${NO_PAYMENT_TAKEN}`;
    case 'AuctionNotEnded':
      return 'The auction is still running. It can be settled once its timer ends.';
    case 'AuctionActive':
      return 'A bid is live, so this cannot be changed until its auction settles.';
    case 'Expired':
      if (functionName === 'createOffer') {
        return `This listing’s auction has ended, so it no longer takes bids. Settle it to complete the sale. ${NO_PAYMENT_TAKEN}`;
      }
      if (functionName === 'acceptOffer') {
        return 'This offer has expired and can no longer be accepted.';
      }
      return 'This has expired and can no longer be used.';
    case 'NotExpired':
      return 'This has not expired yet.';
    case 'InvalidOffer':
      return 'This offer is no longer open. Refresh the list to see its current state.';
    default:
      return undefined;
  }
}

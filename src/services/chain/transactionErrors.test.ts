import { describe, expect, it } from 'vitest';
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  parseAbi,
  type Abi,
} from 'viem';
import { paymentTokenRegistryAbi } from '@/contracts/abis';
import { decodeTransactionError } from './transactionPipeline';

const abi = parseAbi(['function requestRedemption(uint256,bytes32,bytes32)']);
const marketplaceAbi = parseAbi([
  'function cancelOffer(uint256)',
  'error BidLocked(uint256 withdrawableAt)',
]);
const auctionAbi = parseAbi([
  'function bid(uint256,address,uint256)',
  'error BidTooLow()',
  'error PriceNotMet()',
  'error AuctionEnded()',
  'error InvalidAuction()',
  'error Expired()',
  'error InvalidPrice()',
]);

describe('decodeTransactionError', () => {
  it('explains the solvency freeze instead of a bare revert', () => {
    // Insolvent(9999, 10000): the revert live Sepolia returned on 2026-10-08.
    const data =
      '0x1f2c89f0000000000000000000000000000000000000000000000000000000000000270f0000000000000000000000000000000000000000000000000000000000002710';
    const error = decodeTransactionError(
      new ContractFunctionRevertedError({ abi, data, functionName: 'requestRedemption' }),
    );
    expect(error.message).toMatch(/reserves are briefly below full coverage/);
  });

  it.each(['0x032b3d00', '0x35e6141b'] as const)(
    'explains an L2 sequencer outage (%s) instead of a bare selector',
    (data) => {
      const error = decodeTransactionError(
        new ContractFunctionRevertedError({ abi, data, functionName: 'requestRedemption' }),
      );
      expect(error.message).toMatch(/recovering from an outage/);
    },
  );

  it('explains a binding bid and when it can be withdrawn', () => {
    const data = encodeErrorResult({
      abi: marketplaceAbi,
      errorName: 'BidLocked',
      args: [1_800_000_000n],
    });
    const error = decodeTransactionError(
      new ContractFunctionRevertedError({ abi: marketplaceAbi, data, functionName: 'cancelOffer' }),
    );
    expect(error.message).toMatch(/binding until its auction settles/);
    expect(error.message).toMatch(/2027/);
  });

  // The registry's oracle guards are not in the ABI of the contract the wallet
  // called, so they arrive as bare selectors and used to read "reverted".
  it.each([
    ['StalePrice', /price feed .* has not updated recently/],
    ['InvalidPrice', /outside its safe range/],
    ['TokenNotEnabled', /not accepted right now/],
    ['InvalidFeed', /no working price feed/],
  ] as const)('names PaymentTokenRegistry.%s instead of a raw selector', (errorName, message) => {
    const data = encodeErrorResult({ abi: paymentTokenRegistryAbi as Abi, errorName });
    const error = decodeTransactionError(
      new ContractFunctionRevertedError({ abi: auctionAbi, data, functionName: 'bid' }),
    );
    expect(error.message).toMatch(message);
    expect(error.message).not.toMatch(/0x[0-9a-f]{8}/);
  });

  it.each([
    ['bid', 'BidTooLow', /below the current minimum/],
    ['buyNow', 'BidTooLow', /price moved before your purchase confirmed/],
    ['buy', 'PriceNotMet', /price moved before your purchase confirmed/],
    ['createOffer', 'PriceNotMet', /does not cover the offer/],
    ['acceptOffer', 'PriceNotMet', /escrow no longer covers this offer/],
    ['bid', 'AuctionEnded', /auction has ended/],
    ['bid', 'InvalidAuction', /not taking bids/],
    ['settleAuction', 'InvalidAuction', /ended without a bid/],
    ['createOffer', 'Expired', /auction has ended.*Settle it/],
    ['acceptOffer', 'Expired', /offer has expired/],
  ] as const)('explains %s reverting %s in plain words', (functionName, errorName, message) => {
    const data = encodeErrorResult({ abi: auctionAbi, errorName });
    const reverted = new ContractFunctionRevertedError({ abi: auctionAbi, data, functionName });
    const error = decodeTransactionError(reverted);
    expect(error.message).toMatch(message);
    // The same answer when viem wraps it, as a real write does.
    const wrapped = new ContractFunctionExecutionError(reverted, {
      abi: auctionAbi,
      functionName,
      args: [],
    });
    expect(decodeTransactionError(wrapped).message).toMatch(message);
  });

  it('reads the listing ask, not the oracle, into InvalidPrice from list', () => {
    const data = encodeErrorResult({ abi: auctionAbi, errorName: 'InvalidPrice' });
    const error = decodeTransactionError(
      new ContractFunctionRevertedError({ abi: auctionAbi, data, functionName: 'list' }),
    );
    expect(error.message).toMatch(/asking price is not allowed/);
  });
});

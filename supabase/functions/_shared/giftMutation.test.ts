import { describe, expect, it } from 'vitest';
import { reconcileGiftTransfer } from './giftMutation';

describe('gift mutation reconciliation', () => {
  it('does not permit a duplicate while a broadcast outcome is uncertain', () => {
    expect(
      reconcileGiftTransfer({
        currentOwner: '0x1111111111111111111111111111111111111111',
        destinationOwner: '0x2222222222222222222222222222222222222222',
        transactionHash: `0x${'a'.repeat(64)}`,
        receiptStatus: null,
      }),
    ).toBe('pending');
  });

  it('completes from ownership even when receipt polling was lost', () => {
    expect(
      reconcileGiftTransfer({
        currentOwner: '0x2222222222222222222222222222222222222222',
        destinationOwner: '0x2222222222222222222222222222222222222222',
        transactionHash: `0x${'a'.repeat(64)}`,
        receiptStatus: null,
      }),
    ).toBe('complete');
  });

  it.each(['claim', 'cancel'])(
    'completes a mined %s from its exact transfer receipt after the recipient moved it onward',
    () => {
      expect(
        reconcileGiftTransfer({
          currentOwner: '0x3333333333333333333333333333333333333333',
          destinationOwner: '0x2222222222222222222222222222222222222222',
          transactionHash: `0x${'a'.repeat(64)}`,
          receiptStatus: 'success',
          receiptMatchesTransfer: true,
        }),
      ).toBe('complete');
    },
  );

  it('allows retry only after a definite reverted receipt', () => {
    expect(
      reconcileGiftTransfer({
        currentOwner: '0x1111111111111111111111111111111111111111',
        destinationOwner: '0x2222222222222222222222222222222222222222',
        transactionHash: `0x${'a'.repeat(64)}`,
        receiptStatus: 'reverted',
      }),
    ).toBe('failed');
  });

  it.each(['claim', 'cancel'])(
    'keeps an accepted %s broadcast locked when its RPC response is lost',
    () => {
      expect(
        reconcileGiftTransfer({
          currentOwner: '0x1111111111111111111111111111111111111111',
          destinationOwner: '0x2222222222222222222222222222222222222222',
          transactionHash: null,
          receiptStatus: null,
          operationNonce: 41,
          // Pending nonce advanced, proving the operator RPC accepted some
          // transaction at nonce 41 even though it returned no hash.
          senderPendingNonce: 42,
          senderLatestNonce: 41,
          operationAgeMs: 120_000,
        }),
      ).toBe('pending');
    },
  );

  it('retries a lost response only with the same unconsumed nonce', () => {
    expect(
      reconcileGiftTransfer({
        currentOwner: '0x1111111111111111111111111111111111111111',
        destinationOwner: '0x2222222222222222222222222222222222222222',
        transactionHash: null,
        receiptStatus: null,
        operationNonce: 41,
        senderPendingNonce: 41,
        senderLatestNonce: 41,
        operationAgeMs: 30_001,
      }),
    ).toBe('retry_same_nonce');
  });

  it('uses a fresh nonce only after another finalized transaction consumed the unknown nonce', () => {
    expect(
      reconcileGiftTransfer({
        currentOwner: '0x1111111111111111111111111111111111111111',
        destinationOwner: '0x2222222222222222222222222222222222222222',
        transactionHash: null,
        receiptStatus: null,
        operationNonce: 41,
        senderPendingNonce: 42,
        senderLatestNonce: 42,
        operationAgeMs: 120_000,
      }),
    ).toBe('retry_fresh_nonce');
  });
});

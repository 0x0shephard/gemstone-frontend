import { describe, expect, it } from 'vitest';
import {
  UNSUBMITTED_OPERATION_RESET_MS,
  pendingOperationAgeMs,
  reconcileGiftTransfer,
} from './giftMutation';

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

  describe('a worker that died before recording the nonce', () => {
    const unsubmitted = {
      currentOwner: '0x1111111111111111111111111111111111111111',
      destinationOwner: '0x2222222222222222222222222222222222222222',
      transactionHash: null,
      receiptStatus: null,
      operationNonce: null,
      senderPendingNonce: null,
      senderLatestNonce: null,
    };

    it.each(['claim', 'cancel'])(
      'resets a stale %s that recorded neither a nonce nor a hash',
      () => {
        expect(
          reconcileGiftTransfer({
            ...unsubmitted,
            operationAgeMs: UNSUBMITTED_OPERATION_RESET_MS,
          }),
        ).toBe('reset_unsubmitted');
      },
    );

    it('waits while the attempt may still be alive', () => {
      expect(
        reconcileGiftTransfer({
          ...unsubmitted,
          operationAgeMs: UNSUBMITTED_OPERATION_RESET_MS - 1,
        }),
      ).toBe('pending');
    });

    it('never resets once a nonce was recorded, since a broadcast may exist', () => {
      expect(
        reconcileGiftTransfer({
          ...unsubmitted,
          operationNonce: 41,
          senderPendingNonce: 42,
          senderLatestNonce: 41,
          operationAgeMs: 60 * 60_000,
        }),
      ).toBe('pending');
    });

    it('never resets once a hash was recorded', () => {
      expect(
        reconcileGiftTransfer({
          ...unsubmitted,
          transactionHash: `0x${'a'.repeat(64)}`,
          operationAgeMs: 60 * 60_000,
        }),
      ).toBe('pending');
    });

    it('still completes from ownership rather than resetting a transfer that landed', () => {
      expect(
        reconcileGiftTransfer({
          ...unsubmitted,
          currentOwner: unsubmitted.destinationOwner,
          operationAgeMs: 60 * 60_000,
        }),
      ).toBe('complete');
    });

    it('treats a pending row with no start time as abandoned', () => {
      expect(pendingOperationAgeMs(null)).toBe(Number.POSITIVE_INFINITY);
      expect(
        pendingOperationAgeMs('2026-10-29T10:00:00.000Z', Date.parse('2026-10-29T10:05:00.000Z')),
      ).toBe(5 * 60_000);
    });

    it('waits longer than the operator lease before resetting', () => {
      expect(UNSUBMITTED_OPERATION_RESET_MS).toBeGreaterThan(3 * 60_000);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { positionBefore, rowsClosedByRedemptionEvent, type ChainPosition } from './redemptionSweep';

const at = (blockNumber: bigint, transactionIndex = 0, logIndex = 0): ChainPosition => ({
  blockNumber,
  transactionIndex,
  logIndex,
});

const older = { id: 'older', workflowIdHash: '0xaaa', transactionHash: '0x01' };
const newer = { id: 'newer', workflowIdHash: '0xbbb', transactionHash: '0x02' };

describe('redemption sweep cancel/confirm matching', () => {
  it('does not let an old cancel close a newer open request for the same token', () => {
    // Request "older" opened at block 100 and was cancelled at block 110;
    // "newer" opened at block 120 and is open on-chain now. The sweep replays
    // the block-110 cancel.
    const closed = rowsClosedByRedemptionEvent({
      eventName: 'RedemptionCancelled',
      event: at(110n, 3, 5),
      rows: [older, newer],
      chainRecord: { workflowIdHash: '0xBBB', phase: 1 },
      rowPositions: new Map([
        ['older', at(100n)],
        ['newer', at(120n)],
      ]),
    });
    expect(closed).toEqual(['older']);
  });

  it('keeps a newer request opened later even when the record cannot be read', () => {
    const closed = rowsClosedByRedemptionEvent({
      eventName: 'RedemptionCancelled',
      event: at(110n),
      rows: [newer],
      chainRecord: null,
      rowPositions: new Map([['newer', at(120n)]]),
    });
    expect(closed).toEqual([]);
  });

  it('never closes the request the manager still shows open', () => {
    // Opened before the event (e.g. a cancel-then-reopen in one batch), but
    // the current record is this workflow, so the cancel was not for it.
    const closed = rowsClosedByRedemptionEvent({
      eventName: 'RedemptionCancelled',
      event: at(110n, 0, 9),
      rows: [newer],
      chainRecord: { workflowIdHash: '0xbbb', phase: 1 },
      rowPositions: new Map([['newer', at(110n, 0, 1)]]),
    });
    expect(closed).toEqual([]);
  });

  it('leaves a row with no recorded transaction for its owner or the reconciler', () => {
    const closed = rowsClosedByRedemptionEvent({
      eventName: 'RedemptionCancelled',
      event: at(110n),
      rows: [{ id: 'draft', workflowIdHash: '0xccc', transactionHash: null }],
      chainRecord: { workflowIdHash: `0x${'0'.repeat(64)}`, phase: 0 },
      rowPositions: new Map([['draft', null]]),
    });
    expect(closed).toEqual([]);
  });

  it('closes the confirmed workflow the completed record names', () => {
    const closed = rowsClosedByRedemptionEvent({
      eventName: 'RedemptionConfirmed',
      event: at(130n),
      rows: [older, newer],
      chainRecord: { workflowIdHash: '0xbbb', phase: 5 },
      rowPositions: new Map([
        ['older', at(100n)],
        ['newer', at(120n)],
      ]),
    });
    expect(closed).toEqual(['newer']);
  });

  it('orders by block, then transaction, then log', () => {
    expect(positionBefore(at(1n, 9, 9), at(2n, 0, 0))).toBe(true);
    expect(positionBefore(at(2n, 1, 9), at(2n, 2, 0))).toBe(true);
    expect(positionBefore(at(2n, 2, 1), at(2n, 2, 4))).toBe(true);
    expect(positionBefore(at(2n, 2, 4), at(2n, 2, 4))).toBe(false);
    expect(positionBefore(at(3n), at(2n))).toBe(false);
  });
});

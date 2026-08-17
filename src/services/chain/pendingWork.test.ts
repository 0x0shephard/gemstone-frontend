import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeWork,
  hasBroadcastStep,
  listPendingWork,
  nextStepIndex,
  openWork,
  recordBroadcast,
  recordStepStatus,
} from './pendingWork';
import type { Address, Hash } from 'viem';

const ACCOUNT = '0xcc624ffa5df1f3f4b30aa8abd30186a86254f406' as Address;
const HASH = ('0x' + 'ab'.repeat(32)) as Hash;

const work = () =>
  openWork({
    flow: 'buy',
    label: 'Purchase listing',
    account: ACCOUNT,
    chainId: 11155111,
    steps: [
      { kind: 'approval', label: 'Approve the payment allowance', status: 'waiting' },
      { kind: 'call', label: 'Confirm the transaction', status: 'waiting' },
    ],
  });

beforeEach(() => localStorage.clear());

describe('pending work', () => {
  /**
   * The regression this file exists for. A phone suspended while the wallet app
   * is in front can come back to a reloaded tab, so a hash held only in memory
   * is gone — and a transaction that had already been sent looked like a clean
   * failure, with the button offering to send it again.
   */
  it('survives losing everything in memory', () => {
    const opened = work();
    recordBroadcast(opened.id, 0, HASH);

    // Nothing carried over; this is what a fresh page load can see.
    const [recovered] = listPendingWork();
    expect(recovered.steps[0].hash).toBe(HASH);
    expect(recovered.steps[0].status).toBe('broadcast');
  });

  it('knows the difference between sent and not sent', () => {
    const opened = work();
    expect(hasBroadcastStep(listPendingWork()[0])).toBe(false);
    recordBroadcast(opened.id, 0, HASH);
    expect(hasBroadcastStep(listPendingWork()[0])).toBe(true);
  });

  it('resumes at the first step that has not confirmed', () => {
    const opened = work();
    expect(nextStepIndex(listPendingWork()[0])).toBe(0);
    recordStepStatus(opened.id, 0, 'confirmed');
    expect(nextStepIndex(listPendingWork()[0])).toBe(1);
    recordStepStatus(opened.id, 1, 'confirmed');
    // -1 rather than 2: there is nothing left to do, which is a different
    // answer from "continue past the end".
    expect(nextStepIndex(listPendingWork()[0])).toBe(-1);
  });

  it('forgets work once it is closed', () => {
    const opened = work();
    closeWork(opened.id);
    expect(listPendingWork()).toHaveLength(0);
  });

  it('keeps records apart when two are open at once', () => {
    const first = work();
    const second = work();
    recordBroadcast(first.id, 0, HASH);
    const bySecond = listPendingWork().find((item) => item.id === second.id)!;
    expect(hasBroadcastStep(bySecond)).toBe(false);
  });

  it('drops entries too old to still be in flight', () => {
    const opened = work();
    const stale = JSON.parse(localStorage.getItem('dc:pending-work')!) as { createdAt: number }[];
    stale[0].createdAt = Date.now() - 48 * 60 * 60 * 1_000;
    localStorage.setItem('dc:pending-work', JSON.stringify(stale));
    expect(listPendingWork().find((item) => item.id === opened.id)).toBeUndefined();
  });

  it('reads a corrupt store as empty rather than throwing', () => {
    // Every screen that renders a TxButton reads this. A bad entry must not be
    // able to take the page down.
    localStorage.setItem('dc:pending-work', 'not json');
    expect(listPendingWork()).toEqual([]);
  });
});

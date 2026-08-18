import { getPublicClient } from '@wagmi/core';
import type { Hash, PublicClient } from 'viem';
import { wagmiConfig } from '@/providers/wagmi';
import { activeChain } from '@/config/chains';
import {
  closeWork,
  hasBroadcastStep,
  listPendingWork,
  recordStepStatus,
  type PendingWork,
} from './pendingWork';

/**
 * Settles transactions that were broadcast but never seen to confirm.
 *
 * This is the other half of recording a hash before awaiting anything. A phone
 * that was suspended while the wallet app was in front comes back to a tab that
 * may have been reloaded entirely, with a transaction in flight that nothing in
 * memory knows about. Asking the chain is the only way to find out how it ended,
 * and doing so is what makes it safe to refuse a retry in the meantime.
 *
 * Runs on load and whenever the tab becomes visible again, which is precisely
 * the moment someone returns from signing.
 */

async function settle(client: PublicClient, work: PendingWork): Promise<boolean> {
  let settled = true;
  for (const [index, step] of work.steps.entries()) {
    if (step.status !== 'broadcast' || !step.hash) {
      if (step.status === 'waiting') settled = false;
      continue;
    }
    const receipt = await client
      .getTransactionReceipt({ hash: step.hash as Hash })
      .catch(() => undefined);
    if (!receipt) {
      // Still unknown — not mined, or the node has not caught up. Left open so
      // the next visibility change tries again rather than assuming failure.
      settled = false;
      continue;
    }
    recordStepStatus(work.id, index, receipt.status === 'success' ? 'confirmed' : 'failed');
    if (receipt.status !== 'success') return true;
  }
  return settled;
}

export async function reconcilePendingWork(): Promise<void> {
  const outstanding = listPendingWork().filter(hasBroadcastStep);
  if (outstanding.length === 0) return;

  // Same reason as the data service: a receipt is looked up on the chain the
  // transaction was sent to, which is the app's, not wherever the wallet drifted.
  const client = getPublicClient(wagmiConfig, { chainId: activeChain.id }) as
    PublicClient | undefined;
  if (!client) return;

  let anySettled = false;
  for (const work of outstanding) {
    if (await settle(client, work)) {
      closeWork(work.id);
      anySettled = true;
    }
  }

  // Anything that resolved changed chain state the app is showing, and the
  // projection is keyed off this event elsewhere.
  if (anySettled) {
    window.dispatchEvent(new CustomEvent('dc:transaction-confirmed', { detail: {} }));
  }
}

/** Wires reconciliation to load and to returning from another app. */
export function watchPendingWork(): () => void {
  const run = () => void reconcilePendingWork().catch(() => undefined);
  run();
  const onVisible = () => {
    if (document.visibilityState === 'visible') run();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => document.removeEventListener('visibilitychange', onVisible);
}

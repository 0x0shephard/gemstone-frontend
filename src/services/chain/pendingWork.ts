import type { Address, Hash } from 'viem';

/**
 * A durable record of wallet work that has been started but not finished.
 *
 * The problem this exists for is specific to phones. Signing means leaving the
 * browser for a wallet app, and the browser may be suspended or evicted while it
 * is gone. Everything the transaction knew about itself lived in React state, so
 * coming back to a reloaded tab lost it — including the hash of a transaction
 * that had already been broadcast. The UI then reported a plain failure and
 * re-enabled the button, inviting someone to pay twice.
 *
 * So the hash is written to storage the instant it exists, before any await that
 * could be interrupted, and the record survives to be reconciled on return.
 *
 * `localStorage` rather than a store: it has to outlive the whole page, and it
 * has to be writable synchronously. An `await` between "broadcast" and
 * "recorded" is exactly the window that loses the transaction.
 */

const STORAGE_KEY = 'dc:pending-work';

/** Anything older than this is assumed settled and stops being offered. */
const MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export type PendingStepStatus = 'waiting' | 'broadcast' | 'confirmed' | 'failed';

export interface PendingStep {
  kind: 'approval' | 'call';
  /** Shown to the person: "Approve mUSDC", "Confirm purchase". */
  label: string;
  status: PendingStepStatus;
  hash?: Hash;
}

export interface PendingWork {
  id: string;
  /** Matches `TxButton`'s telemetry flow, so a resumed item can be named. */
  flow: string;
  label: string;
  account: Address;
  chainId: number;
  steps: PendingStep[];
  createdAt: number;
}

function read(): PendingWork[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingWork[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A corrupt entry must not take down every screen that reads it.
    return [];
  }
}

function write(items: PendingWork[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Private mode, or a full quota. Losing durability is bad; throwing here
    // would abort a transaction that is otherwise fine, which is worse.
  }
}

/** Everything still in flight, newest first, with stale entries dropped. */
export function listPendingWork(): PendingWork[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  const live = read().filter((work) => work.createdAt > cutoff);
  return [...live].sort((a, b) => b.createdAt - a.createdAt);
}

export function openWork(work: Omit<PendingWork, 'id' | 'createdAt'>): PendingWork {
  const created: PendingWork = {
    ...work,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  write([...read(), created]);
  return created;
}

/**
 * Records a broadcast hash.
 *
 * Called the moment `writeContract` resolves and before anything is awaited.
 * Everything else about recovery depends on this one write happening first.
 */
export function recordBroadcast(id: string, stepIndex: number, hash: Hash): void {
  write(
    read().map((work) =>
      work.id === id
        ? {
            ...work,
            steps: work.steps.map((step, index) =>
              index === stepIndex ? { ...step, status: 'broadcast' as const, hash } : step,
            ),
          }
        : work,
    ),
  );
}

export function recordStepStatus(id: string, stepIndex: number, status: PendingStepStatus): void {
  write(
    read().map((work) =>
      work.id === id
        ? {
            ...work,
            steps: work.steps.map((step, index) =>
              index === stepIndex ? { ...step, status } : step,
            ),
          }
        : work,
    ),
  );
}

export function closeWork(id: string): void {
  write(read().filter((work) => work.id !== id));
}

/** The step a resumed operation should continue from, or -1 when finished. */
export function nextStepIndex(work: PendingWork): number {
  return work.steps.findIndex((step) => step.status !== 'confirmed');
}

/**
 * Whether this work has a transaction on chain whose outcome is still unknown.
 *
 * The distinction that matters for the UI: work that has never been broadcast
 * can be safely retried from the start, and work that has been cannot — retrying
 * that is how the same offer gets funded twice.
 */
export function hasBroadcastStep(work: PendingWork): boolean {
  return work.steps.some((step) => step.status === 'broadcast');
}

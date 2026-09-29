import type { Hash } from 'viem';

/**
 * The vocabulary the transaction pipeline and its buttons share.
 *
 * Kept apart from the pipeline itself because it is a UI contract, and the
 * pipeline drags in wagmi, viem and the chain config. A button that only needs
 * to name a stage should not have to load a chain client to do it — and did not,
 * until an `instanceof` check turned a type-only import into a real one and
 * pulled the whole graph along behind it.
 */

/**
 * Stages a write passes through, announced so the UI can say which one is
 * waiting.
 *
 * On a phone each wallet stage means leaving the browser for a wallet app and
 * coming back, and a token payment needs two of them. A single "Confirming…"
 * spinner covering all of it is indistinguishable from a hang — which is
 * exactly how it was reported.
 */
export type TransactionStep =
  'checking' | 'switching-network' | 'approving' | 'awaiting-signature' | 'confirming';

export function announceStep(step: TransactionStep): void {
  window.dispatchEvent(new CustomEvent('dc:transaction-step', { detail: { step } }));
}

/**
 * One wallet request, waiting on a tap.
 *
 * On a phone every wallet request is an app switch, and the browser may be
 * suspended while it is away. Chaining them automatically meant the second
 * request was built while the tab was in the background: the wallet opened to
 * nothing, because the request it was opened for did not exist yet.
 *
 * A gesture per request fixes the ordering — the request is built while the
 * browser is demonstrably in the foreground, because the person just tapped it.
 */
export interface StepPrompt {
  index: number;
  total: number;
  label: string;
  kind: 'network' | 'approval' | 'call';
}

type StepGate = (prompt: StepPrompt, signal: AbortSignal) => Promise<void>;

export interface StepGateLease {
  token: symbol;
  gate: StepGate;
  controller: AbortController;
}

let stepGate: StepGateLease | undefined;

export class TransactionGestureCancelledError extends Error {
  constructor() {
    super('Transaction cancelled before anything was sent.');
    this.name = 'TransactionGestureCancelledError';
  }
}

/**
 * Registers the gate. A single slot, cleared by the caller when its run ends:
 * two writes at once would contend, which is a limitation rather than a guard,
 * and an acceptable one since a wallet serves one request at a time anyway.
 */
export function acquireStepGate(gate: StepGate): (() => void) | undefined {
  if (stepGate) return;
  const owned: StepGateLease = {
    token: Symbol('transaction-step-gate'),
    gate,
    controller: new AbortController(),
  };
  stepGate = owned;
  return () => {
    // Stale cleanup from an older button must never clear a newer owner.
    if (stepGate?.token !== owned.token) return;
    owned.controller.abort(new TransactionGestureCancelledError());
    stepGate = undefined;
  };
}

/** Binds one transaction run to the gate that owned it at startup. */
export function captureStepGate(): StepGateLease | null {
  return stepGate ?? null;
}

/** Resolves immediately when nothing is registered, which is what tests want. */
export async function awaitGesture(
  prompt: StepPrompt,
  owned: StepGateLease | null = captureStepGate(),
): Promise<void> {
  if (!owned) return;
  if (owned.controller.signal.aborted) throw owned.controller.signal.reason;
  await owned.gate(prompt, owned.controller.signal);
}

/**
 * A failure that happened *after* something was broadcast.
 *
 * Carries the hash, because the one thing that must never be lost is the fact
 * that a transaction exists. Reporting a bare failure and re-enabling the button
 * is how the same purchase gets paid for twice.
 */
export class BroadcastPendingError extends Error {
  constructor(
    message: string,
    readonly hash: Hash,
    readonly workId: string,
  ) {
    super(message);
    this.name = 'BroadcastPendingError';
  }
}

/** A wallet send may have landed, but its RPC response contained no hash. */
export class BroadcastOutcomeUnknownError extends Error {
  constructor(
    message: string,
    readonly workId: string,
  ) {
    super(message);
    this.name = 'BroadcastOutcomeUnknownError';
  }
}

/**
 * The wallet app was opened, but its response never made it back to the page.
 *
 * There is deliberately no retry signal here. The wallet may have submitted the
 * transaction even though the relay lost the reply, so repeating immediately is
 * less safe than checking wallet activity and refreshing the chain-backed view.
 */
export class WalletResponseTimeoutError extends Error {
  constructor() {
    super(
      'The wallet did not return a result. Check MetaMask Activity, then refresh this page before trying again.',
    );
    this.name = 'WalletResponseTimeoutError';
  }
}

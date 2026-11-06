import type { Connector } from 'wagmi';

/**
 * A fixed wait comes first because "idle" alone fires too early: the page is idle
 * while it waits on the chain, so the SDKs would download alongside the first
 * reads they are meant to stay out of the way of.
 */
const SETTLE_DELAY_MS = 5_000;
/** How long to then wait for an idle moment before warming up anyway. */
const IDLE_TIMEOUT_MS = 2_000;

let warmed = false;

/** True once the SDKs have been asked for, so a session may now exist to revive. */
export function walletSdksWarmed(): boolean {
  return warmed;
}

/** Whether wagmi remembers a wallet on this browser, so there may be a session to restore. */
export function hasWalletHistory(storage?: Storage): boolean {
  try {
    const store = storage ?? window.localStorage;
    if (store.getItem('wagmi.recentConnectorId')) return true;
    const persisted = store.getItem('wagmi.store');
    const state = persisted ? (JSON.parse(persisted) as { state?: { current?: unknown } }) : {};
    return Boolean(state.state?.current);
  } catch {
    // Unreadable storage: reconnect as wagmi would by default, rather than risk
    // leaving someone's live session unrestored.
    return true;
  }
}

/**
 * Loads the wallet SDKs once the page has settled, or on the first tap.
 *
 * Later, not never. On a phone, connecting opens the wallet app, and a browser can
 * refuse that jump if it follows a download instead of the tap itself, so the SDK
 * has to be ready before anyone presses Connect. `getProvider` is safe to repeat:
 * each connector creates its client once.
 */
export function warmConnectorsWhenIdle(connectors: readonly Connector[]): () => void {
  let done = false;
  const warm = () => {
    if (done) return;
    done = true;
    warmed = true;
    cancel();
    for (const connector of connectors) {
      connector.getProvider?.().catch(() => undefined);
    }
  };

  let idleHandle: number | undefined;
  const settled = window.setTimeout(() => {
    // Safari has no `requestIdleCallback`.
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(warm, { timeout: IDLE_TIMEOUT_MS });
    } else {
      warm();
    }
  }, SETTLE_DELAY_MS);
  function cancel() {
    window.clearTimeout(settled);
    if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle);
    window.removeEventListener('pointerdown', warm);
  }

  window.addEventListener('pointerdown', warm, { once: true });
  return () => {
    done = true;
    cancel();
  };
}

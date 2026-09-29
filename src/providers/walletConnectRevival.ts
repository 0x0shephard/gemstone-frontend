import type { Config, Connector } from 'wagmi';
import { reconnect } from 'wagmi/actions';
import { isWalletConnectConnector } from '@/services/chain/walletConnectRouting';

/**
 * Restores remote wallet state after the phone comes back to the browser.
 *
 * Connecting on a phone means leaving the browser entirely: the wallet opens,
 * approves, and hands control back. While the tab is in the background the
 * operating system is free to close its sockets, and WalletConnect talks to its
 * relay over one. The approval is published to the relay and queued there, the
 * browser is not listening, and on return the client does not always notice its
 * transport is dead — so the page waits for a message that was delivered to a
 * socket which no longer exists. From the outside that is a spinner that never
 * stops, which is precisely the reported symptom.
 *
 * WalletConnect needs its transport restarted so it can drain relay messages.
 * MetaMask Connect persists and restores its own remote session. Either client
 * can be authorised even though the original connect promise belonged to a
 * browser task the phone discarded. In that state wagmi still needs the
 * approved session registered explicitly, so this recovery performs a bounded
 * reconnect once authorisation appears.
 *
 * Deliberately defensive. It reaches through the provider to the relayer, which
 * is deeper than a public API should have to go, so every step is optional and a
 * failure is swallowed — a wallet that works must never be broken by an attempt
 * to revive one that does not.
 */

interface RelayerLike {
  restartTransport?: () => Promise<void>;
}

interface WalletConnectRevivalOptions {
  reconnectAction?: (
    config: Config,
    parameters: { connectors: readonly Connector[] },
  ) => Promise<unknown>;
  retryDelaysMs?: readonly number[];
  /** Per provider/session operation. A stalled connector must not own recovery forever. */
  operationTimeoutMs?: number;
}

const DEFAULT_RECOVERY_DELAYS_MS = [0, 250, 750, 1_500, 3_000] as const;
const DEFAULT_OPERATION_TIMEOUT_MS = 4_000;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(
          () => reject(new Error('Wallet recovery timed out')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

/** The relayer, wherever this version of the stack happens to keep it. */
function findRelayer(provider: unknown): RelayerLike | undefined {
  const candidate = provider as
    | {
        signer?: { client?: { core?: { relayer?: RelayerLike } } };
        client?: { core?: { relayer?: RelayerLike } };
        core?: { relayer?: RelayerLike };
      }
    | undefined;
  return (
    candidate?.signer?.client?.core?.relayer ??
    candidate?.client?.core?.relayer ??
    candidate?.core?.relayer
  );
}

export function reviveWalletConnectOnReturn(
  config: Config,
  options: WalletConnectRevivalOptions = {},
): () => void {
  if (typeof document === 'undefined') return () => {};

  const reconnectAction = options.reconnectAction ?? reconnect;
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RECOVERY_DELAYS_MS;
  const operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  let waking: Promise<void> | undefined;
  let disposed = false;

  const recoverApprovedSession = async (connector: Connector): Promise<boolean> => {
    try {
      if (!(await bounded(connector.isAuthorized(), operationTimeoutMs))) return false;
    } catch {
      return false;
    }
    try {
      await bounded(reconnectAction(config, { connectors: [connector] }), operationTimeoutMs);
    } catch {
      // A concurrent original connect may win; the next bounded round rechecks.
    }
    return Boolean(config.state.current);
  };

  const wakeOnce = async () => {
    const connected = config.state.connections.get(config.state.current ?? '')?.connector;
    const canRecover = (candidate: Connector | undefined) =>
      candidate?.id === 'metaMaskConnect' || isWalletConnectConnector(candidate);
    /*
     * A disconnected wagmi store can still retain the connector that owned the
     * last session. Try that first, then every recoverable connector. Selecting
     * only the first configured wallet meant an unauthorised MetaMask row hid
     * an already-approved Rainbow/Trust/WalletConnect session behind it.
     */
    const persisted = [...config.state.connections.values()].map((entry) => entry.connector);
    const candidates = [connected, ...persisted, ...config.connectors].filter(
      (candidate, index, all): candidate is Connector =>
        Boolean(canRecover(candidate) && all.indexOf(candidate) === index),
    );

    const prepared: Connector[] = [];
    for (const connector of candidates) {
      if (disposed) return;
      let provider: unknown;
      try {
        provider = connector.getProvider
          ? await bounded(connector.getProvider(), operationTimeoutMs)
          : undefined;
      } catch {
        // A broken candidate must not prevent inspection of the next wallet.
        continue;
      }

      const relayer = findRelayer(provider);
      if (relayer?.restartTransport) {
        try {
          await bounded(relayer.restartTransport(), operationTimeoutMs);
        } catch {
          // Session inspection can still work when the relay private API moved.
        }
      }
      // A connected session only needs its suspended transport revived. Do not
      // attempt to register it again, but do not skip the restart above.
      if (config.state.current) return;
      prepared.push(connector);
    }

    /* Poll all candidates per delivery round. An unauthorised first wallet no
     * longer consumes the complete retry schedule before an approved second
     * connector is even inspected. These checks never open a wallet prompt. */
    for (const delayMs of retryDelaysMs) {
      if (delayMs > 0) await wait(delayMs);
      if (disposed || document.visibilityState !== 'visible' || config.state.current) return;
      for (const connector of prepared) {
        if (await recoverApprovedSession(connector)) return;
      }
    }
  };

  const wake = () => {
    if (disposed || document.visibilityState !== 'visible') return;
    waking ??= wakeOnce().finally(() => {
      waking = undefined;
    });
  };

  document.addEventListener('visibilitychange', wake);
  // Mobile Safari sometimes restores focus without another visibility event.
  window.addEventListener('focus', wake);
  // `pageshow` covers the back/forward cache, where a restored page can carry a
  // socket that was closed while it was frozen.
  window.addEventListener('pageshow', wake);
  // A phone can restore or reload the page before React attaches these event
  // listeners. Recover once on mount as well, so that return is not missed.
  wake();
  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('focus', wake);
    window.removeEventListener('pageshow', wake);
  };
}

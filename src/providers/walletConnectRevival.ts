import type { Config, Connector } from 'wagmi';
import { reconnect } from 'wagmi/actions';
import { isWalletConnectConnector } from '@/services/chain/walletConnectRouting';

/**
 * Wakes the WalletConnect relay socket after the phone comes back to the browser.
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
 * Restarting the transport makes the client redial and drain what the relay held
 * for it. The wallet can then be authorised even though the original connect
 * promise belonged to a browser task the phone discarded. In that state wagmi
 * still needs the approved session registered explicitly, so this recovery also
 * performs a bounded reconnect once authorisation appears.
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
}

const DEFAULT_RECOVERY_DELAYS_MS = [0, 250, 750, 1_500, 3_000] as const;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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
  let waking: Promise<void> | undefined;
  let disposed = false;

  const recoverApprovedSession = async (connector: Connector) => {
    for (const delayMs of retryDelaysMs) {
      if (delayMs > 0) await wait(delayMs);
      if (disposed || document.visibilityState !== 'visible') return;
      if (config.state.current) return;

      /*
       * Approval and relay delivery are separate events. Directly after the
       * app switch the provider can still report unauthorised, then expose the
       * approved session a few hundred milliseconds after its socket resumes.
       * Polling is bounded to one short return window and never opens the
       * wallet: `isAuthorized` only inspects the session already on the client.
       */
      let authorised = false;
      try {
        authorised = await connector.isAuthorized();
      } catch {
        // The next bounded attempt can still succeed after the relay settles.
      }
      if (!authorised) continue;

      try {
        /*
         * The original RainbowKit connect promise may belong to the browser
         * task Android or iOS suspended. Reconnect is the missing second half:
         * it reads the approved WalletConnect session and writes its accounts
         * into wagmi, making `useAccount()` connected without another prompt.
         */
        await reconnectAction(config, { connectors: [connector] });
      } catch {
        // A concurrent original connect may win; re-check state on the retry.
      }
      // Successful wagmi recovery always assigns `current`; reading that key
      // also avoids relying on a status value TypeScript narrowed before the
      // asynchronous reconnect action mutated the external store.
      if (config.state.current) return;
    }
  };

  const wakeOnce = async () => {
    const connected = config.state.connections.get(config.state.current ?? '')?.connector;
    const connector = isWalletConnectConnector(connected)
      ? connected
      : config.connectors.find(isWalletConnectConnector);
    if (!connector?.getProvider) return;

    let provider: unknown;
    try {
      provider = await connector.getProvider();
    } catch {
      return;
    }

    const relayer = findRelayer(provider);
    if (relayer?.restartTransport) {
      try {
        /*
         * Do not trust `relayer.connected` here. On iOS it can remain true
         * after the underlying WebSocket was suspended. A transport restart is
         * idempotent, and this whole return path is coalesced below.
         */
        await relayer.restartTransport();
      } catch {
        // Session recovery can still work when this private API changes.
      }
    }

    await recoverApprovedSession(connector);
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

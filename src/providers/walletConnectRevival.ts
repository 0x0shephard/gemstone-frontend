import type { Config } from 'wagmi';
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
 * for it. This is a nudge, not a protocol change: if the socket is healthy the
 * call is redundant, and if the connector is not WalletConnect there is nothing
 * to do.
 *
 * Deliberately defensive. It reaches through the provider to the relayer, which
 * is deeper than a public API should have to go, so every step is optional and a
 * failure is swallowed — a wallet that works must never be broken by an attempt
 * to revive one that does not.
 */

interface RelayerLike {
  restartTransport?: () => Promise<void>;
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

export function reviveWalletConnectOnReturn(config: Config): () => void {
  if (typeof document === 'undefined') return () => {};

  let restarting: Promise<void> | undefined;
  const wake = async () => {
    if (document.visibilityState !== 'visible') return;
    const connected = config.state.connections.get(config.state.current ?? '')?.connector;
    const connector = isWalletConnectConnector(connected)
      ? connected
      : config.connectors.find(isWalletConnectConnector);
    if (!connector?.getProvider) return;
    try {
      const relayer = findRelayer(await connector.getProvider());
      if (!relayer?.restartTransport) return;

      /*
       * Do not trust `relayer.connected` here. On iOS it can remain true after
       * the underlying WebSocket was suspended, which is the exact state where
       * MetaMask has approved but the browser keeps showing a spinner. A
       * transport restart is idempotent, and coalescing keeps the visibility and
       * focus events from racing each other on the same return.
       */
      restarting ??= relayer.restartTransport().finally(() => {
        restarting = undefined;
      });
      await restarting;
    } catch {
      // A revival that fails leaves things exactly as they were.
    }
  };

  document.addEventListener('visibilitychange', wake);
  // Mobile Safari sometimes restores focus without another visibility event.
  window.addEventListener('focus', wake);
  // `pageshow` covers the back/forward cache, where a restored page can carry a
  // socket that was closed while it was frozen.
  window.addEventListener('pageshow', wake);
  return () => {
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('focus', wake);
    window.removeEventListener('pageshow', wake);
  };
}

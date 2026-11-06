import { useEffect, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from './wagmi';
import { queryClient } from './queryClient';
import { persistOptions } from './queryPersistence';
import { rainbowTheme } from './rainbowTheme';
import { AuthProvider } from './AuthProvider';
import { reviveWalletConnectOnReturn } from './walletConnectRevival';
import { hasWalletHistory, walletSdksWarmed, warmConnectorsWhenIdle } from './walletWarmup';
import { watchPendingWork } from '@/services/chain/reconcilePending';
import { DiagnosticsRecorder } from '@/components/diagnostics/DiagnosticsRecorder';
import { DiagnosticsPanel } from '@/components/diagnostics/DiagnosticsPanel';

/*
 * Reconnecting asks every connector whether it holds a session, and that is what
 * downloads the MetaMask and WalletConnect SDKs. Someone who has never connected
 * here has no session to find, so they are not made to wait for it.
 */
const reconnectOnLoad = hasWalletHistory();

export default function Web3Providers({ children }: { children: ReactNode }) {
  /*
   * Settles anything left in flight, on load and whenever the tab comes back to
   * the front — which is exactly the moment someone returns from their wallet.
   * Mounted here because it needs wagmi's client and must run regardless of
   * which page the return lands on.
   */
  useEffect(watchPendingWork, []);

  /*
   * Reconciling what was already broadcast is only half of coming back from a
   * wallet. The other half is restoring the remote session and registering it
   * with wagmi after Chrome or Safari resumes. WalletConnect may also need its
   * relay transport nudged awake before that state can be read.
   */
  useEffect(
    () =>
      reviveWalletConnectOnReturn(wagmiConfig, {
        // Reviving inspects every connector, which loads the same SDKs. Before
        // they are warm there is no session to revive; after, a first-time
        // connection on a phone needs this as much as anyone's.
        isReady: () => reconnectOnLoad || walletSdksWarmed(),
      }),
    [],
  );

  useEffect(
    () => (reconnectOnLoad ? undefined : warmConnectorsWhenIdle(wagmiConfig.connectors)),
    [],
  );

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={reconnectOnLoad}>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <RainbowKitProvider theme={rainbowTheme} modalSize="compact">
          <AuthProvider>
            {children}
            <DiagnosticsRecorder />
            <DiagnosticsPanel />
          </AuthProvider>
        </RainbowKitProvider>
      </PersistQueryClientProvider>
    </WagmiProvider>
  );
}

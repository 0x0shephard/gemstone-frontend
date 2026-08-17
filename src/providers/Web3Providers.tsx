import { useEffect, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from './wagmi';
import { queryClient } from './queryClient';
import { rainbowTheme } from './rainbowTheme';
import { AuthProvider } from './AuthProvider';
import { watchPendingWork } from '@/services/chain/reconcilePending';

export default function Web3Providers({ children }: { children: ReactNode }) {
  /*
   * Settles anything left in flight, on load and whenever the tab comes back to
   * the front — which is exactly the moment someone returns from their wallet.
   * Mounted here because it needs wagmi's client and must run regardless of
   * which page the return lands on.
   */
  useEffect(watchPendingWork, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rainbowTheme} modalSize="compact">
          <AuthProvider>{children}</AuthProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

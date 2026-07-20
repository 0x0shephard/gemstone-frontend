import { WagmiProvider } from 'wagmi';
import { QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { RouterProvider } from 'react-router-dom';
import { wagmiConfig } from './providers/wagmi';
import { queryClient } from './providers/queryClient';
import { rainbowTheme } from './providers/rainbowTheme';
import { AuthProvider } from './providers/AuthProvider';
import { router } from './router';

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rainbowTheme} modalSize="compact">
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

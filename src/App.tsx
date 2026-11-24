import { Suspense, useEffect } from 'react';
import { lazyRoute } from '@/lib/lazyRoute';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { AppErrorBoundary } from './components/config/AppErrorBoundary';
import { ConfigurationGate } from './components/config/ConfigurationGate';
import { ConsentBanner } from './components/privacy/ConsentBanner';
import { capturePageView } from './lib/telemetry';

const Web3Providers = lazyRoute(() => import('./providers/Web3Providers'));

export default function App() {
  // One page view per navigation; does nothing without analytics consent.
  useEffect(() => router.subscribe(() => capturePageView()), []);

  return (
    <AppErrorBoundary>
      {/*
        Renders nothing, because index.html's skeleton shows for as long as #root
        is empty. Anything here would replace it with a blank page.
      */}
      <Suspense fallback={null}>
        <Web3Providers>
          <ConfigurationGate>
            <RouterProvider router={router} />
          </ConfigurationGate>
          <ConsentBanner />
        </Web3Providers>
      </Suspense>
    </AppErrorBoundary>
  );
}

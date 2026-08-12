import { Suspense } from 'react';
import { lazyRoute } from '@/lib/lazyRoute';
import { RouterProvider } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { router } from './router';
import { ConfigurationGate } from './components/config/ConfigurationGate';

const Web3Providers = lazyRoute(() => import('./providers/Web3Providers'));

export default function App() {
  return (
    <Sentry.ErrorBoundary
      fallback={<p role="alert">Digital Carat encountered an unexpected error.</p>}
    >
      <Suspense
        fallback={<div className="min-h-screen bg-vault" aria-label="Loading application" />}
      >
        <Web3Providers>
          <ConfigurationGate>
            <RouterProvider router={router} />
          </ConfigurationGate>
        </Web3Providers>
      </Suspense>
    </Sentry.ErrorBoundary>
  );
}

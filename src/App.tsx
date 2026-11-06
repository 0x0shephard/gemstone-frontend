import { Suspense } from 'react';
import { lazyRoute } from '@/lib/lazyRoute';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { AppErrorBoundary } from './components/config/AppErrorBoundary';
import { ConfigurationGate } from './components/config/ConfigurationGate';

const Web3Providers = lazyRoute(() => import('./providers/Web3Providers'));

export default function App() {
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
        </Web3Providers>
      </Suspense>
    </AppErrorBoundary>
  );
}

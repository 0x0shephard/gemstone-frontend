import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/States';

const AppShell = lazy(() =>
  import('@/components/layout/AppShell').then((module) => ({ default: module.AppShell })),
);
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const SignupPage = lazy(() => import('@/pages/SignupPage'));
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage'));
const MarketplacePage = lazy(() => import('@/pages/MarketplacePage'));
const GemDetailPage = lazy(() => import('@/pages/GemDetailPage'));
const AuctionsPage = lazy(() => import('@/pages/AuctionsPage'));
const SwapsPage = lazy(() => import('@/pages/SwapsPage'));
const RedeemPage = lazy(() => import('@/pages/RedeemPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const SellerPage = lazy(() => import('@/pages/SellerPage'));
const AboutPage = lazy(() => import('@/pages/AboutPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

function route(element: ReactNode) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-content p-8">
          <Skeleton className="h-64" />
        </div>
      }
    >
      {element}
    </Suspense>
  );
}

export const router = createBrowserRouter([
  { path: '/', element: route(<LandingPage />) },
  { path: '/login', element: route(<LoginPage />) },
  { path: '/signup', element: route(<SignupPage />) },
  { path: '/onboarding', element: route(<OnboardingPage />) },
  {
    element: route(<AppShell />),
    children: [
      { path: '/marketplace', element: route(<MarketplacePage />) },
      { path: '/gem/:gemId', element: route(<GemDetailPage />) },
      { path: '/auctions', element: route(<AuctionsPage />) },
      { path: '/swaps', element: route(<SwapsPage />) },
      { path: '/redeem', element: route(<RedeemPage />) },
      { path: '/profile', element: route(<ProfilePage />) },
      { path: '/seller', element: route(<SellerPage />) },
      { path: '/about', element: route(<AboutPage />) },
    ],
  },
  { path: '/app', element: <Navigate to="/marketplace" replace /> },
  { path: '*', element: route(<NotFoundPage />) },
]);

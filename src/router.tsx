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
const VerifyPage = lazy(() => import('@/pages/VerifyPage'));
const AboutPage = lazy(() => import('@/pages/AboutPage'));
const GiftClaimPage = lazy(() => import('@/pages/GiftClaimPage'));
const GiftCodeEntryPage = lazy(() => import('@/pages/GiftCodeEntryPage'));
const CanvaCallbackPage = lazy(() => import('@/pages/CanvaCallbackPage'));
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
      // Deliberately absent from navigation. Non-members are shown the same
      // "not found" the API returns rather than a sign-in prompt.
      { path: '/verify', element: route(<VerifyPage />) },
      { path: '/about', element: route(<AboutPage />) },
      // Where a printed gift card's QR code points. Public: the recipient may
      // have no account at all when they arrive, and the page's job is to show
      // them what the gift is before it asks them for anything.
      // The gift email says "enter this code at /gift", so that bare path has to
      // resolve to something. Without it the instruction landed on Not Found.
      { path: '/gift', element: route(<GiftCodeEntryPage />) },
      { path: '/gift/:code', element: route(<GiftClaimPage />) },
      // Canva's registered redirect URI. One fixed path, since Canva matches
      // the whole URL against the integration's settings.
      { path: '/canva/callback', element: route(<CanvaCallbackPage />) },
    ],
  },
  { path: '/app', element: <Navigate to="/marketplace" replace /> },
  { path: '*', element: route(<NotFoundPage />) },
]);

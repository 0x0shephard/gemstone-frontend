import { Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/States';
import { lazyRoute } from '@/lib/lazyRoute';

const AppShell = lazyRoute(() =>
  import('@/components/layout/AppShell').then((module) => ({ default: module.AppShell })),
);
const LandingPage = lazyRoute(() => import('@/pages/LandingPage'));
const LoginPage = lazyRoute(() => import('@/pages/LoginPage'));
const SignupPage = lazyRoute(() => import('@/pages/SignupPage'));
const OnboardingPage = lazyRoute(() => import('@/pages/OnboardingPage'));
const MarketplacePage = lazyRoute(() => import('@/pages/MarketplacePage'));
const GemDetailPage = lazyRoute(() => import('@/pages/GemDetailPage'));
const AuctionsPage = lazyRoute(() => import('@/pages/AuctionsPage'));
const SwapsPage = lazyRoute(() => import('@/pages/SwapsPage'));
const RedeemPage = lazyRoute(() => import('@/pages/RedeemPage'));
const ProfilePage = lazyRoute(() => import('@/pages/ProfilePage'));
const SellerPage = lazyRoute(() => import('@/pages/SellerPage'));
const VerifyPage = lazyRoute(() => import('@/pages/VerifyPage'));
const AboutPage = lazyRoute(() => import('@/pages/AboutPage'));
const GiftClaimPage = lazyRoute(() => import('@/pages/GiftClaimPage'));
const GiftCodeEntryPage = lazyRoute(() => import('@/pages/GiftCodeEntryPage'));
const CanvaCallbackPage = lazyRoute(() => import('@/pages/CanvaCallbackPage'));
const NotFoundPage = lazyRoute(() => import('@/pages/NotFoundPage'));

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

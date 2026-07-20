import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import LandingPage from '@/pages/LandingPage';
import LoginPage from '@/pages/LoginPage';
import SignupPage from '@/pages/SignupPage';
import OnboardingPage from '@/pages/OnboardingPage';
import MarketplacePage from '@/pages/MarketplacePage';
import GemDetailPage from '@/pages/GemDetailPage';
import AuctionsPage from '@/pages/AuctionsPage';
import SwapsPage from '@/pages/SwapsPage';
import RedeemPage from '@/pages/RedeemPage';
import ProfilePage from '@/pages/ProfilePage';
import SellerPage from '@/pages/SellerPage';
import AboutPage from '@/pages/AboutPage';
import NotFoundPage from '@/pages/NotFoundPage';

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/onboarding', element: <OnboardingPage /> },
  {
    element: <AppShell />,
    children: [
      { path: '/marketplace', element: <MarketplacePage /> },
      { path: '/gem/:gemId', element: <GemDetailPage /> },
      { path: '/auctions', element: <AuctionsPage /> },
      { path: '/swaps', element: <SwapsPage /> },
      { path: '/redeem', element: <RedeemPage /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/seller', element: <SellerPage /> },
      { path: '/about', element: <AboutPage /> },
    ],
  },
  { path: '/app', element: <Navigate to="/marketplace" replace /> },
  { path: '*', element: <NotFoundPage /> },
]);

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BrandMark } from '@/components/ui/BrandMark';
import { Button } from '@/components/ui/Button';
import { ColorSchemeToggle } from '@/components/theme/ColorSchemeToggle';
import { AccountMenu } from '@/components/auth/AccountMenu';
import { MusdcFaucetButton } from '@/components/wallet/MusdcFaucetButton';
import { useAuth } from '@/providers/AuthProvider';

const LINKS = [
  { label: 'Marketplace', to: '/marketplace' },
  { label: 'Auctions', to: '/auctions' },
  { label: 'Swaps', to: '/swaps' },
  { label: 'Redeem', to: '/redeem' },
  { label: 'About', to: '/about' },
];

/** Sticky landing-page navigation bar. */
export function TopNav() {
  const { pathname } = useLocation();
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header
      className="sticky top-0 z-40 border-b border-white/[0.065]"
      style={{ background: 'var(--dc-header)', backdropFilter: 'blur(18px)' }}
    >
      <nav className="mx-auto flex min-h-[72px] max-w-content items-center justify-between px-4 sm:px-6 md:px-10">
        <Link to="/" aria-label="Digital Carat home">
          <BrandMark size={19} />
        </Link>
        <div className="hidden items-center gap-1 rounded-[12px] border border-white/[0.065] bg-white/[0.02] p-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="rounded-[8px] px-3 py-2 text-[12.5px] font-medium text-ink-muted transition-colors hover:bg-white/[0.035] hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <MusdcFaucetButton compact />
          <ColorSchemeToggle />
          {user || loading ? (
            <AccountMenu />
          ) : (
            <>
              <Link to="/login" className="hidden sm:block">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link to="/signup" className="hidden sm:block">
                <Button size="sm">Create account</Button>
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-white/[0.1] text-ink md:hidden"
            aria-label="Open navigation"
            aria-expanded={open}
          >
            {open ? (
              '×'
            ) : (
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="M5 8h14M5 16h14" />
              </svg>
            )}
          </button>
        </div>
      </nav>
      {open && (
        <div className="animate-dcfade border-t border-white/[0.065] bg-sidebar px-4 py-3 md:hidden">
          <nav className="grid grid-cols-2 gap-2">
            {LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="rounded-[12px] border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-[13px] font-medium text-ink-soft"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          {!user && !loading && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:hidden">
              <Link to="/login">
                <Button block variant="secondary" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link to="/signup">
                <Button block size="sm">
                  Create account
                </Button>
              </Link>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

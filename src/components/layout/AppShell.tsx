import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { metaForPath } from './pageMeta';
import { ChainSyncStatus } from '@/components/chain/ChainSyncStatus';
import { MobileDock } from './MobileDock';
import { groupForPath } from './navigation';
import { ColorSchemeToggle } from '@/components/theme/ColorSchemeToggle';
import { AccountMenu } from '@/components/auth/AccountMenu';
import { MusdcFaucetButton } from '@/components/wallet/MusdcFaucetButton';

/** App layout: hidden navigation drawer + sticky content header + routed <Outlet/>. */
export function AppShell() {
  const { pathname } = useLocation();
  const { title, subtitle } = metaForPath(pathname);
  const group = groupForPath(pathname);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSidebarOpen(false);
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [sidebarOpen]);

  const closeSidebar = () => {
    setSidebarOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  return (
    <div className="min-h-screen bg-vault">
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-30 flex min-h-[76px] items-center justify-between gap-4 border-b border-white/[0.065] px-4 py-3.5 sm:px-6 md:px-8"
          style={{ background: 'var(--dc-header)', backdropFilter: 'blur(18px)' }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <button
              ref={menuButtonRef}
              type="button"
              aria-label="Open navigation"
              aria-controls="app-navigation-drawer"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
              className="group grid h-10 w-10 shrink-0 place-items-center rounded-[4px] border border-white/[0.08] bg-white/[0.025] text-ink-muted transition-colors hover:border-atelier/30 hover:bg-atelier/[0.08] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-atelier/70"
            >
              <span className="flex w-[17px] flex-col gap-[4px]" aria-hidden="true">
                <span className="h-px w-full bg-current transition-transform group-hover:translate-x-0.5" />
                <span className="h-px w-[13px] bg-current transition-[width] group-hover:w-full" />
                <span className="h-px w-full bg-current transition-transform group-hover:-translate-x-0.5" />
              </span>
            </button>
            <div className="hidden h-8 w-px bg-white/[0.08] sm:block" aria-hidden="true" />
            <div className="min-w-0">
              <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-atelier">
                {group}
              </div>
              <h1 className="truncate font-display text-[18px] font-medium tracking-[-0.02em] text-ink sm:text-[20px]">
                {title}
              </h1>
              {subtitle && (
                <p className="hidden truncate text-[12px] text-ink-muted lg:block">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="hidden xl:block">
              <ChainSyncStatus />
            </div>
            <MusdcFaucetButton compact />
            <ColorSchemeToggle />
            <AccountMenu />
          </div>
        </header>

        <main className="dc-mobile-safe mx-auto w-full max-w-content flex-1 animate-dcfade px-4 py-6 sm:px-6 sm:py-8 md:px-8 lg:py-10">
          <Outlet />
        </main>
      </div>
      <MobileDock />
    </div>
  );
}

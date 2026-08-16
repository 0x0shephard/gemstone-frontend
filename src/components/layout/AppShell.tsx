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
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { useScrollReveal } from '@/hooks/useScrollReveal';

/** App layout: hidden navigation drawer + sticky content header + routed <Outlet/>. */
export function AppShell() {
  const { pathname } = useLocation();
  /*
   * Mounted here rather than per page. `[data-reveal]` is `opacity: 0` until
   * revealed, so a routed page that forgot to call this rendered its gem cards
   * permanently invisible — which is what happened to the profile and seller
   * pages. Keyed on the path so each navigation re-observes.
   *
   * LandingPage sits outside this shell and keeps its own call.
   */
  useScrollReveal([pathname]);
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
          // Tighter gutters below `sm` so the page title is not truncated by a
          // dozen pixels. The faucet and theme toggle stay: neither exists
          // anywhere else, so hiding them would strand both on a phone.
          className="sticky top-0 z-30 flex min-h-[76px] items-center justify-between gap-2 border-b border-line/[0.065] px-3 py-3.5 sm:gap-4 sm:px-6 md:px-8"
          style={{ background: 'var(--dc-header)', backdropFilter: 'blur(18px)' }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              ref={menuButtonRef}
              type="button"
              aria-label="Open navigation"
              aria-controls="app-navigation-drawer"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
              className="group grid h-10 w-10 shrink-0 place-items-center rounded-[4px] border border-line/[0.08] bg-line/[0.025] text-ink-muted transition-colors hover:border-atelier/30 hover:bg-atelier/[0.08] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-atelier/70"
            >
              <span className="flex w-[17px] flex-col gap-[4px]" aria-hidden="true">
                <span className="h-px w-full bg-current transition-transform group-hover:translate-x-0.5" />
                <span className="h-px w-[13px] bg-current transition-[width] group-hover:w-full" />
                <span className="h-px w-full bg-current transition-transform group-hover:-translate-x-0.5" />
              </span>
            </button>
            <div className="hidden h-8 w-px bg-line/[0.08] sm:block" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              {/* The eyebrow is the first thing to go: at 390px it costs a line
                  of height and pushes the title into an ellipsis. */}
              <div className="mb-1 hidden text-[9.5px] font-semibold uppercase tracking-[0.16em] text-atelier sm:block">
                {group}
              </div>
              <h1 className="truncate font-display text-[16px] font-medium tracking-[-0.02em] text-ink sm:text-[20px]">
                {title}
              </h1>
              {subtitle && (
                <p className="hidden truncate text-[12px] text-ink-muted lg:block">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            <div className="hidden xl:block">
              <ChainSyncStatus />
            </div>
            <MusdcFaucetButton compact />
            <NotificationBell />
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

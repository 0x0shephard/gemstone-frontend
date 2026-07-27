import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BrandMark } from '@/components/ui/BrandMark';
import { ChainSyncStatus } from '@/components/chain/ChainSyncStatus';
import { navigationGroups, primaryMobileItems } from './navigation';
import { cn } from '@/lib/cn';

export function MobileDock() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  const secondaryItems = navigationGroups
    .flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })))
    .filter((item) => !primaryMobileItems.some((primary) => primary.to === item.to));
  const moreActive = secondaryItems.some((item) => pathname === item.to);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-[3px] md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {open && (
        <section
          role="dialog"
          aria-modal="true"
          aria-label="More destinations"
          className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 animate-dcslideup overflow-hidden rounded-[4px] border border-line/[0.12] bg-elevated shadow-[0_28px_80px_rgba(0,0,0,.6)] md:hidden"
        >
          <div className="flex items-center justify-between border-b border-line/[0.07] px-5 py-4">
            <BrandMark size={17} />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line/[0.1] text-ink-muted hover:text-ink"
              aria-label="Close navigation"
            >
              ×
            </button>
          </div>
          <nav className="grid grid-cols-2 gap-2 p-3">
            {secondaryItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-[72px] flex-col justify-between rounded-[4px] border p-3.5 text-[13px]',
                    isActive
                      ? 'border-atelier/35 bg-atelier/[0.08] text-ink'
                      : 'border-line/[0.07] bg-line/[0.025] text-ink-muted',
                  )
                }
              >
                <span>{item.icon}</span>
                <span>
                  <span className="block text-[10px] uppercase tracking-[0.12em] text-ink-dim">
                    {item.group}
                  </span>
                  <span className="mt-0.5 block font-medium">{item.label}</span>
                </span>
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-line/[0.07] px-4 py-3">
            <ChainSyncStatus />
          </div>
        </section>
      )}

      <nav
        aria-label="Primary mobile navigation"
        className="fixed inset-x-2 bottom-2 z-40 grid grid-cols-5 rounded-[4px] border border-line/[0.11] bg-sidebar/90 p-1.5 pb-[calc(.375rem+env(safe-area-inset-bottom))] shadow-[0_20px_60px_rgba(0,0,0,.5)] backdrop-blur-xl md:hidden"
      >
        {primaryMobileItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-[4px] text-[10.5px] font-medium transition-colors',
                isActive ? 'bg-line/[0.075] text-ink' : 'text-ink-dim',
              )
            }
          >
            {item.icon}
            <span>{item.shortLabel ?? item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={cn(
            'flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-[4px] text-[10.5px] font-medium transition-colors',
            open || moreActive ? 'bg-line/[0.075] text-ink' : 'text-ink-dim',
          )}
          aria-expanded={open}
          aria-label="More"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
          <span>More</span>
        </button>
      </nav>
    </>
  );
}

import { useEffect, useRef } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { BrandMark } from '@/components/ui/BrandMark';
import { useAuth } from '@/providers/AuthProvider';
import { useKyc } from '@/hooks/useKyc';
import { cn } from '@/lib/cn';
import { navigationGroups } from './navigation';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { user } = useAuth();
  const { isApproved } = useKyc();
  const name = (user?.user_metadata?.full_name as string) || user?.email?.split('@')[0] || 'Guest';
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', trapFocus);
    return () => document.removeEventListener('keydown', trapFocus);
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 animate-dcfade bg-black/70 backdrop-blur-[3px]"
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        id="app-navigation-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Main navigation"
        className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,calc(100vw-20px))] flex-col border-r border-white/[0.09] bg-sidebar shadow-[24px_0_80px_rgba(0,0,0,.5)] animate-dcdrawer"
      >
        <div className="flex items-center justify-between px-6 pb-8 pt-6">
          <Link
            to="/"
            onClick={onClose}
            aria-label="Digital Carat home"
            className="inline-flex rounded-[4px] focus-visible:outline-offset-4"
          >
            <BrandMark size={19} />
          </Link>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="grid h-9 w-9 place-items-center rounded-[4px] border border-white/[0.08] bg-white/[0.025] text-ink-muted transition-colors hover:border-atelier/30 hover:bg-atelier/[0.08] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-atelier/70"
          >
            <span className="relative block h-4 w-4" aria-hidden="true">
              <span className="absolute left-0 top-1/2 h-px w-4 -translate-y-1/2 rotate-45 bg-current" />
              <span className="absolute left-0 top-1/2 h-px w-4 -translate-y-1/2 -rotate-45 bg-current" />
            </span>
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
          {navigationGroups.map((group) => (
            <div key={group.label}>
              <div className="mb-1.5 px-3 text-[9.5px] font-semibold uppercase tracking-[0.17em] text-ink-dim">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={onClose}
                    className={({ isActive }) =>
                      cn(
                        'group flex h-10 items-center gap-3 rounded-[4px] border px-3 text-[13.5px] transition-all',
                        isActive
                          ? 'border-white/[0.09] bg-atelier/[0.09] font-semibold text-ink shadow-[inset_3px_0_0_var(--dc-accent)]'
                          : 'border-transparent font-medium text-ink-muted hover:border-white/[0.05] hover:bg-white/[0.025] hover:text-ink',
                      )
                    }
                  >
                    <span className="text-ink-dim transition-colors group-hover:text-ink-soft">
                      {item.icon}
                    </span>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/[0.07] p-4">
          <div className="rounded-[4px] border border-white/[0.07] bg-white/[0.025] p-3.5">
            <div className="flex items-center gap-3">
              <span
                className="h-2 w-2 rounded-full bg-emerald"
                style={{ boxShadow: '0 0 10px rgba(76,201,154,.65)' }}
              />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-ink">{name}</div>
                <div className="truncate text-[11px] text-ink-dim">
                  {user ? 'Signed in' : 'Browsing publicly'}
                </div>
              </div>
            </div>
            {isApproved && (
              <div className="mt-2.5 border-t border-white/[0.06] pt-2.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-emerald">
                Verified identity
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

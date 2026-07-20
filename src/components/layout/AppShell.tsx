import { Outlet, useLocation, Link } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { metaForPath } from './pageMeta';
import { WalletStatus } from '@/components/wallet/WalletStatus';
import { useAuth } from '@/providers/AuthProvider';

/** App layout: fixed sidebar + sticky content header + routed <Outlet/>. */
export function AppShell() {
  const { pathname } = useLocation();
  const { title, subtitle } = metaForPath(pathname);
  const { user } = useAuth();
  const initials =
    ((user?.user_metadata?.full_name as string) || user?.email || 'AV')
      .split(/[\s@]/)[0]
      .slice(0, 2)
      .toUpperCase();

  return (
    <div className="flex min-h-screen bg-vault">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4 md:px-8"
          style={{ background: 'rgba(8,8,10,.72)', backdropFilter: 'blur(14px)' }}
        >
          <div className="min-w-0">
            <h1 className="truncate text-[18px] font-bold text-ink">{title}</h1>
            {subtitle && <p className="truncate text-[12.5px] text-ink-muted">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-3">
            <WalletStatus />
            <Link
              to="/profile"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.04] text-[12px] font-semibold text-ink"
            >
              {initials}
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-content flex-1 animate-dcfade px-5 py-8 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

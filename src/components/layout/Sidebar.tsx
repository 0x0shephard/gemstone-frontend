import { NavLink } from 'react-router-dom';
import { BrandMark } from '@/components/ui/BrandMark';
import { useAuth } from '@/providers/AuthProvider';
import { useKyc } from '@/hooks/useKyc';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/cn';

const NAV = [
  { label: 'Marketplace', to: '/marketplace' },
  { label: 'Auctions', to: '/auctions' },
  { label: 'Swaps', to: '/swaps' },
  { label: 'Redeem', to: '/redeem' },
  { label: 'Portfolio', to: '/profile' },
  { label: 'Seller portal', to: '/seller' },
  { label: 'About us', to: '/about' },
];

export function Sidebar() {
  const { user, linkedWallet } = useAuth();
  const { isApproved } = useKyc();
  const name = (user?.user_metadata?.full_name as string) || user?.email?.split('@')[0] || 'Guest';

  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-white/[0.06] bg-sidebar md:flex">
      <div className="px-5 py-[22px]">
        <BrandMark size={18} />
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex h-10 items-center gap-3 rounded-[9px] px-3.5 text-[13.5px] transition-colors',
                isActive
                  ? 'border-l-2 border-ink-soft bg-white/[0.05] font-semibold text-ink'
                  : 'border-l-2 border-transparent font-medium text-ink-muted hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: isActive ? '#E5484D' : '#3A3A42' }}
                />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/[0.06] p-4">
        <div className="flex items-center gap-3">
          <span
            className="h-2 w-2 rounded-full bg-emerald"
            style={{ boxShadow: '0 0 8px #35B98A' }}
          />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-ink">{name}</div>
            <div className="truncate font-mono text-[11px] text-ink-dim">
              {shortenAddress(linkedWallet) }
            </div>
          </div>
        </div>
        {isApproved && (
          <div className="mt-2 inline-block rounded-[5px] bg-emerald/10 px-2 py-0.5 text-[10.5px] font-semibold text-emerald">
            Verified
          </div>
        )}
      </div>
    </aside>
  );
}

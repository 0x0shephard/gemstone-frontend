import { Link } from 'react-router-dom';
import { BrandMark } from '@/components/ui/BrandMark';
import { Button } from '@/components/ui/Button';

const LINKS = [
  { label: 'Marketplace', to: '/marketplace' },
  { label: 'Auctions', to: '/auctions' },
  { label: 'Swaps', to: '/swaps' },
  { label: 'Redeem', to: '/redeem' },
  { label: 'About', to: '/about' },
];

/** Sticky landing-page navigation bar. */
export function TopNav() {
  return (
    <header
      className="sticky top-0 z-40 border-b border-white/[0.06]"
      style={{ background: 'rgba(8,8,10,.72)', backdropFilter: 'blur(14px)' }}
    >
      <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-[18px] md:px-10">
        <Link to="/">
          <BrandMark />
        </Link>
        <div className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="text-[13.5px] text-ink-faint hover:text-ink">
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link to="/signup" className="hidden sm:block">
            <Button size="sm">Create account</Button>
          </Link>
        </div>
      </nav>
    </header>
  );
}

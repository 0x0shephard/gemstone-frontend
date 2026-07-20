import { Link } from 'react-router-dom';
import { BrandMark } from '@/components/ui/BrandMark';

/** Centered card on a subtle radial-gradient backdrop, for login/signup. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-10"
      style={{
        background:
          'radial-gradient(60% 50% at 50% 0%, rgba(91,141,239,.06), transparent 60%), radial-gradient(50% 40% at 80% 100%, rgba(229,72,77,.05), transparent 60%), #08080A',
      }}
    >
      <Link to="/" className="mb-8">
        <BrandMark />
      </Link>
      {children}
      <p className="mt-8 text-[11.5px] text-ink-dim">
        Custody by Helvetia Vault Services · Insured by Lloyd&apos;s syndicate
      </p>
    </div>
  );
}

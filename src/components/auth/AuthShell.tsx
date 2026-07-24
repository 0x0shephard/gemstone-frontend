import { Link } from 'react-router-dom';
import { BrandMark } from '@/components/ui/BrandMark';
import { BackToHomeLink } from '@/components/layout/BackToHomeLink';

/** Centered card on a subtle radial-gradient backdrop, for login/signup. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10"
      style={{
        background:
          'radial-gradient(60% 50% at 50% 0%, color-mix(in srgb, var(--dc-accent) 10%, transparent), transparent 60%), radial-gradient(50% 40% at 80% 100%, color-mix(in srgb, var(--dc-accent-2) 7%, transparent), transparent 60%), var(--dc-vault)',
      }}
    >
      <div className="dc-dot-grid pointer-events-none absolute inset-0 opacity-35" />
      <BackToHomeLink className="absolute left-4 top-4 z-10 sm:left-6 sm:top-6" />
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

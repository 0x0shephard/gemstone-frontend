import { BrandMark } from '@/components/ui/BrandMark';

/** Landing footer with custody / insurance attestations. */
export function Footer() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-content flex-col items-start justify-between gap-4 px-6 py-10 md:flex-row md:items-center md:px-10">
        <BrandMark size={18} />
        <p className="text-[12px] text-ink-dim">
          Custody by Helvetia Vault Services · Insured by Lloyd&apos;s syndicate · © 2026 Digital
          Carat
        </p>
      </div>
    </footer>
  );
}

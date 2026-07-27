import { BrandMark } from '@/components/ui/BrandMark';

/** Landing footer with custody / insurance attestations. */
export function Footer() {
  return (
    <footer className="border-t border-line/[0.065] bg-sidebar">
      <div className="mx-auto grid max-w-content gap-8 px-6 py-10 md:grid-cols-[1fr_auto] md:items-end md:px-10">
        <div>
          <BrandMark size={18} />
          <p className="mt-3 max-w-md text-[12.5px] leading-relaxed text-ink-muted">
            Verified physical gemstones with on-chain ownership, reserve transparency and
            compliance-gated redemption.
          </p>
        </div>
        <div className="text-left md:text-right">
          <div className="font-mono text-[10px] uppercase tracking-[0.13em] text-emerald">
            Custody network verified
          </div>
          <p className="mt-2 text-[11.5px] text-ink-dim">© 2026 Digital Carat · Sepolia testnet</p>
        </div>
      </div>
    </footer>
  );
}

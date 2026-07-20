import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatTile } from '@/components/ui/StatTile';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useLanding } from '@/hooks/useData';
import { useScrollReveal } from '@/hooks/useScrollReveal';

const PILLARS: { title: string; body: string; color: string }[] = [
  {
    title: 'Verified custody',
    body: 'Every stone is graded by an independent gemologist and held in an insured custodian vault with a public, third-party attestation.',
    color: '#35B98A',
  },
  {
    title: 'On-chain reserves',
    body: 'Each gem carries a reserve posted on-chain. Minting and redemption are blocked until that reserve is fully funded — no exceptions.',
    color: '#5B8DEF',
  },
  {
    title: 'NFT minting',
    body: 'Once vaulted and funded, a gemstone is minted as a single DGE NFT — a one-to-one, transferable claim on the physical asset.',
    color: '#D7D7DD',
  },
  {
    title: 'Primary auctions',
    body: '24-hour timed auctions settle automatically on expiry. If a reserve is short at settlement, a top-up is required before the sale finalizes.',
    color: '#E5A23C',
  },
  {
    title: 'Secondary marketplace',
    body: 'List, buy, and make 24-hour offers on minted gems. Reserve shortfall is always shown and included in the buyer’s total.',
    color: '#E5484D',
  },
  {
    title: 'Swaps & redemption',
    body: 'Trade gem-for-gem with an optional cash delta, or redeem: the NFT locks and burns as the physical stone is released from the vault.',
    color: '#35B98A',
  },
];

export default function AboutPage() {
  const { data } = useLanding();
  useScrollReveal([data]);

  return (
    <div className="space-y-12">
      {/* Intro */}
      <section data-reveal className="max-w-3xl">
        <StatusBadge tone="danger" dot className="mb-5">
          Protocol live · {data?.gemsInVault ?? 148} gemstones in vault
        </StatusBadge>
        <h1 className="text-[34px] font-extrabold leading-[1.1] tracking-tight text-ink md:text-[40px]">
          Physical gemstones, made liquid — without giving up the stone.
        </h1>
        <p className="mt-5 text-[15.5px] leading-relaxed text-ink-muted">
          Digital Carat is an institutional-grade protocol for tokenized gemstones. Each DGE NFT
          represents exactly one verified physical stone — certified, vaulted, insured, and backed by
          an on-chain reserve. Hold it, trade it, auction it, swap it, or redeem the physical gemstone
          itself. The chain tracks ownership; the vault holds the asset; the reserve keeps them
          honest.
        </p>
      </section>

      {/* Stats */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Gemstones in vault" value={data?.gemsInVault ?? 148} />
        <StatTile label="Reserve backing" value="On-chain" valueColor="#5B8DEF" />
        <StatTile label="Custody" value={<span className="text-[18px]">Insured vaults</span>} />
        <StatTile label="Settlement" value="Automated" valueColor="#35B98A" />
      </section>

      {/* Pillars */}
      <section className="space-y-5">
        <div data-reveal>
          <p className="text-[12px] font-semibold uppercase tracking-eyebrow text-ink-muted">
            How the protocol works
          </p>
          <h2 className="mt-2 text-[26px] font-bold tracking-tight text-ink">
            Seven modules, one honest asset
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Card key={p.title} hoverLift data-reveal data-reveal-delay={(i % 3) * 80} className="p-6">
              <span className="mb-3 block h-2 w-2 rounded-full" style={{ background: p.color }} />
              <h3 className="text-[16px] font-semibold text-ink">{p.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{p.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Custody & insurance */}
      <section className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card data-reveal className="p-7">
          <h3 className="text-[18px] font-semibold text-ink">Custody &amp; insurance</h3>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">
            Stones are held by professional custodians in high-security vaults and underwritten by a
            Lloyd&apos;s syndicate. Every gem entering the protocol carries a certificate hash and a
            custody attestation recorded against its on-chain record, so provenance and location are
            independently verifiable at any time.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {data?.trustSignals.map((t) => (
              <StatusBadge key={t.title} color={t.color} dot>
                {t.title}
              </StatusBadge>
            ))}
          </div>
        </Card>

        <Card data-reveal className="p-7">
          <h3 className="text-[18px] font-semibold text-ink">Where value flows</h3>
          <p className="mt-2 text-[13.5px] text-ink-muted">
            Sale proceeds are split transparently at settlement.
          </p>
          <div className="mt-5 space-y-2.5">
            {data?.treasurySplit.map((s) => (
              <div key={s.label} className="flex items-center gap-3 text-[13.5px]">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
                <span className="flex-1 text-ink-soft">{s.label}</span>
                <span className="font-mono text-ink">{s.pct}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Principles */}
      <section className="space-y-5">
        <div data-reveal>
          <p className="text-[12px] font-semibold uppercase tracking-eyebrow text-ink-muted">
            What we stand for
          </p>
          <h2 className="mt-2 text-[26px] font-bold tracking-tight text-ink">Principles</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ['Reserves are never hidden', 'If a gem’s reserve is short, we show it — prominently — and fold the top-up into your total. You always see the real cost.'],
            ['Open to buyers, gated for sellers', 'Anyone can browse, buy, bid, swap, and hold with no KYC. Selling and redemption require verified identity, as regulation demands.'],
            ['The chain is a receipt, not the asset', 'The NFT is a claim; the stone is the value. Redemption always leads back to a physical gemstone in your hands.'],
          ].map(([title, body]) => (
            <Card key={title} data-reveal className="p-6">
              <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section
        data-reveal
        className="flex flex-col items-start justify-between gap-5 rounded-[18px] border border-white/[0.08] bg-card p-8 md:flex-row md:items-center"
      >
        <div>
          <h2 className="text-[22px] font-bold text-ink">Explore the vault</h2>
          <p className="mt-1 text-[14px] text-ink-muted">
            Browse verified gemstones or start the seller onboarding process.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to="/marketplace">
            <Button size="lg">Explore gems</Button>
          </Link>
          <Link to="/seller">
            <Button variant="secondary" size="lg">
              Start selling
            </Button>
          </Link>
        </div>
      </section>

      <p className="pt-2 text-[12px] text-ink-dim">
        Custody by Helvetia Vault Services · Insured by Lloyd&apos;s syndicate · © 2026 Digital Carat
      </p>
    </div>
  );
}

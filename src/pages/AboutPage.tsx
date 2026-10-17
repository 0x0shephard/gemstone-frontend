import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatTile } from '@/components/ui/StatTile';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useLanding } from '@/hooks/useData';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import { displayVaultCount } from './vaultStats';

const REASONS: { title: string; body: string; color: string }[] = [
  {
    title: 'Not an empty token',
    body: 'You are not trading with virtual value but with a real-life asset. The blockchain is just the vehicle. Instead of trading with a paper or bank receipt, your ownership is recorded on Ethereum.',
    color: 'var(--dc-emerald)',
  },
  {
    title: '1 Token = 1 Gemstone',
    body: 'You are not buying a fraction of a gemstone. Each token is the full ownership of a single and unique gemstone.',
    color: 'var(--dc-sapphire)',
  },
  {
    title: 'Only natural stones',
    body: 'We allow only certified natural gemstones to be auctioned, not synthetic gemstones.',
    color: 'var(--dc-amber)',
  },
  {
    title: 'Gemstones hold a perennial value',
    body: 'Unlike many other collectible tokens in art or collection cards that might hold zero value in the coming years, gemstones are a limited natural resource valued for millennia, and they will always hold value that you can pass on to future generations.',
    color: 'var(--dc-ruby)',
  },
];

export default function AboutPage() {
  const { data } = useLanding();
  useScrollReveal([data]);

  return (
    <div className="space-y-12">
      {/* Stats */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Gemstones in vault" value={displayVaultCount(data?.gemsInVault)} />
        <StatTile label="Reserve backing" value="On-chain" valueColor="var(--dc-sapphire)" />
        <StatTile label="Custody" value={<span className="text-[18px]">Insured vaults</span>} />
        <StatTile label="Settlement" value="Automated" valueColor="var(--dc-emerald)" />
      </section>

      {/* Why gemstone tokens */}
      <section className="space-y-5">
        <div data-reveal>
          <h2 className="text-[26px] font-semibold tracking-tight text-ink">
            Why gemstone tokens?
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {REASONS.map((reason, i) => (
            <Card
              key={reason.title}
              hoverLift
              data-reveal
              data-reveal-delay={(i % 2) * 80}
              className="p-6"
            >
              <span
                className="mb-3 block h-2 w-2 rounded-full"
                style={{ background: reason.color }}
              />
              <h3 className="text-[16px] font-semibold text-ink">{reason.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{reason.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Custody & insurance */}
      <section className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card data-reveal className="p-7">
          <h3 className="text-[18px] font-semibold text-ink">Custody &amp; insurance</h3>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">
            Every gem entering the protocol carries a certificate hash and a custody attestation
            recorded against its on-chain record, so provenance and location are independently
            verifiable at any time.
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
                <span className="h-2.5 w-2.5 rounded-[4px]" style={{ background: s.color }} />
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
          <h2 className="mt-2 text-[26px] font-semibold tracking-tight text-ink">Principles</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {[
            [
              'Open to buyers, gated for sellers',
              'Anyone can browse, buy, bid, swap, and hold with no KYC. Selling and redemption require verified identity, as regulation demands.',
            ],
            [
              'The chain is a receipt, not the asset',
              'The NFT is a claim; the stone is the value. Redemption always leads back to a physical gemstone in your hands.',
            ],
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
        className="dc-facet-border flex flex-col items-start justify-between gap-5 overflow-hidden rounded-[4px] border border-line/[0.09] bg-elevated p-8 md:flex-row md:items-center"
      >
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-atelier">
            Start with confidence
          </p>
          <h2 className="mt-2 text-[22px] font-semibold text-ink">Explore the vault</h2>
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
        Custody by Helvetia Vault Services · Insured by Lloyd&apos;s syndicate · © 2026 Digital
        Carat
      </p>
    </div>
  );
}

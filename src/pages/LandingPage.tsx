import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { TopNav } from '@/components/layout/TopNav';
import { Footer } from '@/components/layout/Footer';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { GemCard } from '@/components/gem/GemCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { CountdownBadge } from '@/components/ui/CountdownBadge';
import { useLanding } from '@/hooks/useData';
import { useScrollReveal } from '@/hooks/useScrollReveal';

const GemScene = lazy(() =>
  import('@/components/three/GemScene').then((m) => ({ default: m.GemScene })),
);

export default function LandingPage() {
  const { data } = useLanding();
  useScrollReveal([data]);

  return (
    <div className="min-h-screen bg-vault">
      <TopNav />

      {/* Hero */}
      <section className="mx-auto grid max-w-content items-center gap-10 px-6 py-14 md:min-h-[88vh] md:grid-cols-2 md:px-10">
        <div className="order-2 md:order-1">
          <StatusBadge tone="danger" dot className="mb-6">
            Protocol live · {data?.gemsInVault ?? 148} gemstones in vault
          </StatusBadge>
          <h1 className="text-[42px] font-extrabold leading-[1.02] tracking-tightest text-ink md:text-[60px]">
            The vault for tokenized gemstones.
          </h1>
          <p className="mt-6 max-w-lg text-[16px] leading-relaxed text-ink-muted">
            Every Digital Carat NFT is one verified physical gemstone — graded, vaulted, insured,
            and backed by an on-chain reserve. Buy, auction, swap, or redeem the stone itself.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/marketplace">
              <Button size="lg">Explore gems</Button>
            </Link>
            <Link to="/onboarding">
              <Button variant="secondary" size="lg">
                Connect wallet
              </Button>
            </Link>
            <Link to="/seller">
              <Button variant="ghost" size="lg">
                Start selling
              </Button>
            </Link>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data?.trustSignals.map((t) => (
              <div key={t.title} className="rounded-[12px] border border-white/[0.08] bg-card p-3.5">
                <span className="mb-2 block h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />
                <div className="text-[13px] font-semibold text-ink">{t.title}</div>
                <div className="mt-0.5 text-[11.5px] text-ink-dim">{t.sub}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative order-1 h-[320px] md:order-2 md:h-[78vh]">
          <Suspense fallback={<div className="h-full w-full" />}>
            <GemScene />
          </Suspense>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/[0.1] bg-black/40 px-3 py-1.5 font-mono text-[10.5px] text-ink-dim backdrop-blur">
            {data?.featuredCaption ?? 'GEM-RB-0417 · Burmese Ruby · 3.12ct'}
          </span>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-content px-6 py-20 md:px-10">
        <div data-reveal className="mb-10">
          <p className="text-[12px] font-semibold uppercase tracking-eyebrow text-ink-muted">
            How it works
          </p>
          <h2 className="mt-2 text-[30px] font-bold tracking-tight text-ink md:text-[34px]">
            From certified stone to redeemable token
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {data?.howSteps.map((step, i) => (
            <Card
              key={step.num}
              hoverLift
              data-reveal
              data-reveal-delay={i * 90}
              className="p-6"
            >
              <div className="font-mono text-[13px] text-ink-dim">{step.num}</div>
              <h3 className="mt-3 text-[17px] font-semibold text-ink">{step.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{step.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Featured gems */}
      <section className="mx-auto max-w-content px-6 py-10 md:px-10">
        <div data-reveal className="mb-8 flex items-end justify-between">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-eyebrow text-ink-muted">
              Featured
            </p>
            <h2 className="mt-2 text-[30px] font-bold tracking-tight text-ink md:text-[34px]">
              In the vault now
            </h2>
          </div>
          <Link to="/marketplace" className="text-[13px] font-semibold text-ink-soft hover:text-ink">
            View all →
          </Link>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data?.featured.map((gem, i) => (
            <GemCard key={gem.id} gem={gem} revealDelay={i * 100} />
          ))}
        </div>
      </section>

      {/* Auctions + reserve mechanics */}
      <section className="mx-auto max-w-content px-6 py-20 md:px-10">
        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          <Card data-reveal className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[18px] font-semibold text-ink">Live auction activity</h3>
              <StatusBadge tone="success" dot>
                Live
              </StatusBadge>
            </div>
            <div className="divide-y divide-white/[0.06]">
              {data?.auctions.map((a) => (
                <div key={a.gem.id} className="flex items-center gap-3 py-3">
                  <span
                    className="h-11 w-11 shrink-0 rounded-[10px]"
                    style={{ background: a.gem.thumb }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-ink">{a.gem.name}</div>
                    <div className="font-mono text-[11.5px] text-ink-dim">{a.gem.gemId}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[14px] font-semibold text-ink">
                      {a.highestBidFmt}
                    </div>
                    <CountdownBadge seconds={a.secondsLeft} />
                  </div>
                </div>
              ))}
            </div>
            <Link to="/auctions" className="mt-4 inline-block text-[13px] font-semibold text-ink-soft hover:text-ink">
              Go to auctions →
            </Link>
          </Card>

          <Card data-reveal className="p-6">
            <h3 className="text-[18px] font-semibold text-ink">Reserve mechanics</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
              Each gem carries an on-chain reserve. Minting and redemption are blocked until the
              reserve is fully funded — no exceptions.
            </p>

            <div className="mt-5 space-y-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-ink-muted">Example reserve</span>
                <span className="font-semibold text-amber">Short 82%</span>
              </div>
              <ProgressBar value={82} />
              <div
                className="rounded-[8px] px-3 py-2 text-[12px]"
                style={{ background: 'rgba(229,162,60,.08)', border: '1px solid rgba(229,162,60,.28)', color: '#E5C99A' }}
              >
                Top-up required before this gem can be minted or redeemed.
              </div>
            </div>

            <div className="mt-6">
              <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                Treasury sale split
              </p>
              <div className="space-y-2">
                {data?.treasurySplit.map((s) => (
                  <div key={s.label} className="flex items-center gap-3 text-[13px]">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
                    <span className="flex-1 text-ink-soft">{s.label}</span>
                    <span className="font-mono text-ink">{s.pct}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </section>

      <Footer />
    </div>
  );
}

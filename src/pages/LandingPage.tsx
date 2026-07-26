import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { TopNav } from '@/components/layout/TopNav';
import { Footer } from '@/components/layout/Footer';
import { Button } from '@/components/ui/Button';
import { GemCard } from '@/components/gem/GemCard';
import { CountdownBadge } from '@/components/ui/CountdownBadge';
import { ownershipPathSteps } from '@/content/ownershipPath';
import { useLanding } from '@/hooks/useData';
import { useScrollReveal } from '@/hooks/useScrollReveal';

const GemScene = lazy(() =>
  import('@/components/three/GemScene').then((m) => ({ default: m.GemScene })),
);

/** Which role enforces each step. Presentation only; the copy itself is shared. */
const STEP_ACTORS = ['Verifier · Custodian', 'Buyer', 'Primary sale', 'Holder'];

const REDEMPTION_STEPS: [string, string, boolean?][] = [
  ['Reserve checked', 'The stone must be fully reserved before delivery can open.'],
  ['Compliance checked', 'Your address must be cleared to redeem.'],
  ['Token locked', 'Transfers stop. The token cannot be sold while delivery is open.'],
  ['Custodian confirms', 'The vault hands the stone over and confirms it on-chain.'],
  ['Token burned', 'The claim is destroyed permanently. You keep the stone.', true],
];

export default function LandingPage() {
  const { data } = useLanding();
  useScrollReveal([data]);

  return (
    <div className="min-h-screen bg-vault">
      <TopNav />

      {/* Hero */}
      <section className="relative mx-auto grid max-w-content items-center gap-8 overflow-hidden px-5 py-10 sm:px-6 md:min-h-[86vh] md:grid-cols-[1.05fr_.95fr] md:px-10 md:py-14">
        <div className="dc-dot-grid pointer-events-none absolute inset-y-0 left-0 w-[52%] opacity-35" />
        <div className="relative order-2 md:order-1">
          <div className="mb-7 inline-flex items-center gap-2 border-l-2 border-ink-muted pl-3 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
            Vault open
            <span className="h-1 w-1 rounded-full bg-emerald" />
            {data?.gemsInVault ?? 148} stones under custody
          </div>
          <h1 className="max-w-[10ch] font-display text-[43px] font-medium leading-[0.98] tracking-[-0.055em] text-ink sm:text-[54px] md:text-[66px]">
            Own the stone. Trade the claim.
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-[1.75] text-ink-muted sm:text-[16px]">
            One token represents one expert-approved gemstone in professional custody. Inspect its
            reserve, acquire it on-chain, trade it, or redeem the physical asset.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/marketplace">
              <Button size="lg">Enter marketplace</Button>
            </Link>
            <Link to="/seller">
              <Button variant="ghost" size="lg">
                Submit a gemstone
              </Button>
            </Link>
          </div>

          <div className="mt-12 grid grid-cols-2 border-y border-white/[0.075] sm:grid-cols-4">
            {data?.trustSignals.map((t) => (
              <div
                key={t.title}
                className="border-white/[0.065] px-0 py-3.5 pr-3 sm:border-r sm:px-3 sm:first:pl-0 sm:last:border-r-0"
              >
                <span className="mb-2 block h-1 w-5 rounded-full" style={{ background: t.color }} />
                <div className="text-[11.5px] font-semibold text-ink-soft">{t.title}</div>
                <div className="mt-0.5 text-[10.5px] leading-snug text-ink-dim">{t.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/*
         * The stone floats rather than sitting in a panel: concentric rings and
         * a halo tinted by the stone's own hue, nothing else competing with it.
         */}
        <div className="relative order-1 mx-auto aspect-square w-full max-w-[520px] md:order-2">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-[8%] rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgb(var(--dc-ruby-rgb) / 0.17), transparent 66%)',
            }}
          />
          <svg
            aria-hidden
            viewBox="0 0 100 100"
            className="pointer-events-none absolute inset-0 h-full w-full text-white/[0.07]"
          >
            {[46, 37, 28].map((r) => (
              <circle
                key={r}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke="currentColor"
                strokeWidth="0.35"
              />
            ))}
          </svg>
          <Suspense fallback={<div className="h-full w-full" />}>
            <GemScene />
          </Suspense>
        </div>
      </section>

      {/* Gates. Each step is enforced by a different role. */}
      <section className="mx-auto max-w-content border-t border-white/[0.06] px-6 py-20 md:px-10">
        <div data-reveal className="mb-10">
          <h2 className="max-w-[20ch] font-display text-[30px] font-medium tracking-[-0.035em] text-ink md:text-[36px]">
            From expert review to physical redemption
          </h2>
          <p className="mt-3 max-w-[56ch] text-[14px] leading-relaxed text-ink-muted">
            Minting is blocked until every gate passes. Each one is a separate role, so no single
            address can walk a stone from intake to sale on its own.
          </p>
        </div>
        <div
          data-reveal
          className="grid overflow-hidden rounded-[4px] border border-white/[0.08] sm:grid-cols-2 lg:grid-cols-4"
        >
          {ownershipPathSteps.map((step, i) => (
            <div
              key={step.num}
              className="flex flex-col gap-2.5 border-b border-r border-white/[0.06] bg-card p-6 last:border-r-0 lg:border-b-0"
            >
              <div className="font-mono text-[10px] tracking-[0.1em] text-ink-dim">{step.num}</div>
              <h3 className="font-display text-[15px] font-medium tracking-[-0.015em] text-ink">
                {step.title}
              </h3>
              <p className="text-[12.5px] leading-relaxed text-ink-muted">{step.body}</p>
              <div className="mt-auto pt-3 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-dim">
                {STEP_ACTORS[i]}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Reserve model */}
      <section className="mx-auto max-w-content border-t border-white/[0.06] px-6 py-20 md:px-10">
        <div data-reveal className="mb-9">
          <h2 className="max-w-[22ch] font-display text-[30px] font-medium tracking-[-0.035em] text-ink md:text-[36px]">
            Custody costs money, so it is funded up front
          </h2>
          <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-ink-muted">
            Every stone carries a reserve that pays for vaulting, insurance and the cost of shipping
            it to you. Whoever buys next covers whatever is missing, in the same transaction, so the
            protocol never absorbs unpaid custody cost.
          </p>
        </div>
        <div
          data-reveal
          className="grid overflow-hidden rounded-[4px] border border-white/[0.08] sm:grid-cols-2 lg:grid-cols-4"
        >
          {[
            ['10%', 'Reserve on stones valued under $1,000'],
            ['4%', 'Reserve on stones valued $1,000 and above'],
            [data?.treasurySplit?.[0]?.pct ?? '80%', 'Of every primary sale goes to the seller'],
            ['2%', 'Secondary fee, taken from the sale price'],
          ].map(([value, label]) => (
            <div
              key={label}
              className="border-b border-r border-white/[0.06] bg-card p-6 last:border-r-0 lg:border-b-0"
            >
              <div className="font-mono text-[30px] tracking-[-0.04em] text-ink">{value}</div>
              <div className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Featured */}
      <section className="mx-auto max-w-content border-t border-white/[0.06] px-6 py-20 md:px-10">
        <div data-reveal className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-[30px] font-medium tracking-[-0.035em] text-ink md:text-[36px]">
              Available now
            </h2>
            <p className="mt-2 text-[14px] text-ink-muted">Listed at their verified valuation.</p>
          </div>
          <Link to="/marketplace" className="text-[13px] font-medium text-ink-soft hover:text-ink">
            View all →
          </Link>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data?.featured.map((gem, i) => (
            <GemCard key={gem.gemId.toString()} gem={gem} revealDelay={i * 100} />
          ))}
        </div>
      </section>

      {/* Redemption burns the claim */}
      <section className="mx-auto max-w-content border-t border-white/[0.06] px-6 py-20 md:px-10">
        <div className="grid items-center gap-11 lg:grid-cols-2">
          <div data-reveal>
            <h2 className="max-w-[22ch] font-display text-[30px] font-medium tracking-[-0.035em] text-ink md:text-[36px]">
              Ask for the stone and the token stops existing
            </h2>
            <p className="mt-3 max-w-[56ch] text-[14px] leading-relaxed text-ink-muted">
              A Digital Carat token is a claim, not a souvenir. When you want the physical gemstone
              the token locks, the custodian ships, and the claim is burned. There is no version of
              this where you keep both.
            </p>
            <Link to="/redeem" className="mt-6 inline-block">
              <Button variant="secondary">How redemption works</Button>
            </Link>
          </div>
          <div
            data-reveal
            className="overflow-hidden rounded-[4px] border border-white/[0.08] bg-card"
          >
            {REDEMPTION_STEPS.map(([title, body, terminal], i) => (
              <div
                key={title}
                className={`flex items-start gap-3.5 border-b border-white/[0.06] px-5 py-4 last:border-b-0 ${
                  terminal ? 'bg-panel' : ''
                }`}
              >
                <span className="mt-0.5 font-mono text-[10px] text-ink-dim">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <div
                    className={`text-[13.5px] font-medium ${terminal ? 'text-ruby' : 'text-ink'}`}
                  >
                    {title}
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Live auctions */}
      {data?.auctions && data.auctions.length > 0 && (
        <section className="mx-auto max-w-content border-t border-white/[0.06] px-6 py-20 md:px-10">
          <div data-reveal className="mb-8 flex items-end justify-between gap-4">
            <h2 className="font-display text-[30px] font-medium tracking-[-0.035em] text-ink md:text-[36px]">
              Live auctions
            </h2>
            <Link to="/auctions" className="text-[13px] font-medium text-ink-soft hover:text-ink">
              Go to auctions →
            </Link>
          </div>
          <div
            data-reveal
            className="overflow-hidden rounded-[4px] border border-white/[0.08] bg-card"
          >
            {data.auctions.map((a) => (
              <div
                key={a.gem.gemId.toString()}
                className="flex items-center gap-3.5 border-b border-white/[0.06] px-5 py-3.5 last:border-b-0"
              >
                <span
                  className="h-10 w-10 shrink-0 rounded-[4px]"
                  style={{ background: a.gem.thumb }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-ink">{a.gem.name}</div>
                  <div className="font-mono text-[11px] text-ink-dim">{a.gem.displayId}</div>
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
        </section>
      )}

      {/* Closing */}
      <section className="mx-auto max-w-content border-t border-white/[0.06] px-6 py-24 text-center md:px-10">
        <h2 className="mx-auto max-w-[22ch] font-display text-[32px] font-medium tracking-[-0.04em] text-ink md:text-[42px]">
          Start with one stone
        </h2>
        <Link to="/marketplace" className="mt-7 inline-block">
          <Button size="lg">Enter marketplace</Button>
        </Link>
      </section>

      <Footer />
    </div>
  );
}

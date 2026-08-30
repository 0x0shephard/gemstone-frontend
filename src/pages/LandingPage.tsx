import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { TopNav } from '@/components/layout/TopNav';
import { Footer } from '@/components/layout/Footer';
import { Button } from '@/components/ui/Button';
import { GemCard } from '@/components/gem/GemCard';
import { CountdownBadge } from '@/components/ui/CountdownBadge';
import { ownershipPathSteps } from '@/content/ownershipPath';
import { useFeeTiers, useLanding } from '@/hooks/useData';
import { useScrollReveal } from '@/hooks/useScrollReveal';

import { SceneBoundary } from '@/components/three/SceneBoundary';

const GemScene = lazy(() =>
  import('@/components/three/GemScene').then((m) => ({ default: m.GemScene })),
);

/** Who acts at each stage of the lifecycle. Presentation only; the copy is shared. */
const STEP_ACTORS = [
  'Seller, laboratory, custodian',
  'Primary auction',
  'Token holder, marketplace',
  'Token holder, custodian',
  'Buyer, payment registry',
];

const CUSTODY_BENEFITS = [
  {
    title: 'Trade ownership safely',
    body: 'Buy or sell the token while the specific gemstone remains protected in third-party custody.',
  },
  {
    title: 'Redeem the gemstone',
    body: 'Start a verified fulfilment process whenever you decide to take possession of the physical stone.',
  },
];

const REDEMPTION_STEPS: [string, string, boolean?][] = [
  ['Reserve checked', 'The stone must be fully reserved before delivery can open.'],
  ['Compliance checked', 'Your address must be cleared to redeem.'],
  ['Token locked', 'Transfers stop. The token cannot be sold while delivery is open.'],
  ['Custodian confirms', 'The vault hands the stone over and confirms it on-chain.'],
  ['Token burned', 'The claim is destroyed permanently. You keep the stone.', true],
];

export default function LandingPage() {
  const { data } = useLanding();
  const { data: feeTiers, isLoading: feeTiersLoading, isError: feeTiersError } = useFeeTiers();
  useScrollReveal([data, feeTiers]);

  return (
    <div className="min-h-[100dvh] bg-vault">
      <TopNav />

      {/* Hero */}
      <section className="relative mx-auto grid max-w-content items-center gap-8 overflow-hidden px-5 py-10 sm:px-6 md:min-h-[86vh] md:grid-cols-[1.05fr_.95fr] md:px-10 md:py-14">
        <div className="dc-dot-grid pointer-events-none absolute inset-y-0 left-0 w-[52%] opacity-35" />
        {/* `min-w-0`: a grid item defaults to `min-width: auto` and so refuses to
            shrink below its content's min-content width. The long CTA labels
            below are `whitespace-nowrap` by default, which made that 397px on a
            390px phone, overflowing the column, clipping the body copy, and
            pushing the gemstone render off centre. */}
        <div className="relative order-2 min-w-0 md:order-1">
          <div className="mb-7 inline-flex items-center gap-2 border-l-2 border-ink-muted pl-3 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
            Vault open
            <span className="h-1 w-1 rounded-full bg-emerald" />
            {data?.gemsInVault ?? 148} stones under custody
          </div>
          <h1 className="max-w-[14ch] font-display text-[43px] font-medium leading-[0.98] tracking-[-0.055em] text-ink sm:text-[54px] md:text-[66px]">
            Trade gemstones. Secure your claim.
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-[1.75] text-ink-muted sm:text-[16px]">
            A Digital Carat token represents a specific gemstone held in secure, third-party custody
            at a partner bank.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link to="/marketplace" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto">
                Browse marketplace
              </Button>
            </Link>
            <Link to="/seller" className="w-full sm:w-auto">
              <Button variant="ghost" size="lg" className="w-full sm:w-auto">
                Start seller KYC
              </Button>
            </Link>
          </div>
        </div>

        {/*
         * The stone floats rather than sitting in a panel: concentric rings and
         * a halo tinted by the stone's own hue, nothing else competing with it.
         */}
        <div className="relative order-1 mx-auto aspect-square w-full min-w-0 max-w-[520px] md:order-2">
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
            className="pointer-events-none absolute inset-0 h-full w-full text-line/[0.07]"
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
          {/*
            The boundary sits outside Suspense so it catches both a chunk that
            will not load and a WebGL context that will not start. Either way the
            rings and halo above remain and the page is unharmed.
          */}
          <SceneBoundary>
            <Suspense fallback={<div className="h-full w-full" />}>
              <GemScene />
            </Suspense>
          </SceneBoundary>
        </div>
      </section>

      {/* The claim has two outcomes while the stone stays in professional custody. */}
      <section className="border-y border-line/[0.06] bg-card">
        <div className="mx-auto grid max-w-content gap-8 px-6 py-10 md:grid-cols-[0.8fr_1.2fr] md:px-10 md:py-12">
          <div data-reveal>
            <h2 className="max-w-[18ch] font-display text-[24px] font-medium tracking-[-0.03em] text-ink md:text-[28px]">
              Custody protects both paths
            </h2>
            <p className="mt-3 max-w-[48ch] text-[13.5px] leading-relaxed text-ink-muted">
              Independent custody keeps the physical gemstone secure while its owner decides whether
              to trade the token or redeem the stone.
            </p>
          </div>
          <div
            data-reveal
            className="grid gap-px overflow-hidden rounded-[4px] bg-line/[0.08] sm:grid-cols-2"
          >
            {CUSTODY_BENEFITS.map((benefit) => (
              <div key={benefit.title} className="bg-vault p-5 sm:p-6">
                <h3 className="text-[14px] font-semibold text-ink">{benefit.title}</h3>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">{benefit.body}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 border-t border-line/[0.07] pt-6 sm:grid-cols-4 md:col-span-2">
            {data?.trustSignals.map((signal) => (
              <div
                key={signal.title}
                className="border-line/[0.065] py-3 pr-3 sm:border-r sm:px-4 sm:first:pl-0 sm:last:border-r-0"
              >
                <span
                  aria-hidden
                  className="mb-2 block h-1 w-5 rounded-full"
                  style={{ background: signal.color }}
                />
                <div className="text-[11.5px] font-semibold text-ink-soft">{signal.title}</div>
                <div className="mt-0.5 text-[10.5px] leading-snug text-ink-dim">{signal.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gates. Each step is enforced by a different role. */}
      <section className="mx-auto max-w-content border-t border-line/[0.06] px-6 py-20 md:px-10">
        <div data-reveal className="mb-10">
          <h2 className="max-w-[20ch] font-display text-[30px] font-medium tracking-[-0.035em] text-ink md:text-[36px]">
            Lifecycle of the Token
          </h2>
          <p className="mt-3 max-w-[72ch] text-[14px] leading-relaxed text-ink-muted">
            Before a gemstone can be minted as an ERC-721 token, the seller completes KYC, an
            approved custodian receives the stone, and a professional laboratory verifies its
            characteristics and valuation.
          </p>
        </div>
        <div
          data-reveal
          className="overflow-hidden rounded-[4px] border border-line/[0.08] bg-card"
        >
          {ownershipPathSteps.map((step, i) => (
            <div
              key={step.num}
              className="grid gap-3 border-b border-line/[0.06] p-5 last:border-b-0 sm:grid-cols-[42px_minmax(0,0.8fr)_minmax(0,1.2fr)] sm:gap-5 sm:p-6"
            >
              <div className="font-mono text-[10px] tracking-[0.1em] text-ink-dim">{step.num}</div>
              <div>
                <h3 className="font-display text-[15px] font-medium tracking-[-0.015em] text-ink">
                  {step.title}
                </h3>
                <div className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-dim">
                  {STEP_ACTORS[i]}
                </div>
              </div>
              <div>
                <p className="text-[12.5px] leading-relaxed text-ink-muted">{step.body}</p>
                {step.points && (
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {step.points.map((point) => (
                      <li
                        key={point}
                        className="border-l border-atelier/45 pl-3 text-[11.5px] leading-relaxed text-ink-dim"
                      >
                        {point}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Reserve model */}
      <section className="mx-auto max-w-content border-t border-line/[0.06] px-6 py-20 md:px-10">
        <div data-reveal className="mb-9">
          <h2 className="max-w-[26ch] font-display text-[30px] font-medium tracking-[-0.035em] text-ink md:text-[36px]">
            How the reserve value at minting works
          </h2>
          <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-ink-muted">
            A reserve margin is added to the gemstone&apos;s approved value and funded when the
            token is minted. It supports eligible custody, insurance, swap, and redemption costs
            carried by that gemstone throughout its token lifecycle.
          </p>
        </div>
        <div data-reveal className="grid gap-6 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div className="rounded-[4px] border border-line/[0.08] bg-card p-6">
            <h3 className="font-display text-[16px] font-medium text-ink">
              One reserve, several costs
            </h3>
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">
              The reserve remains attached to the gemstone&apos;s protocol record. At redemption,
              the custodian confirms physical handover before the token burns and remaining reserve
              assets are released under the active contract rules.
            </p>
            <p className="mt-4 border-l border-atelier/45 pl-3 text-[11.5px] leading-relaxed text-ink-dim">
              The transaction quote is authoritative. It calculates any reserve shortfall from the
              live contract before a buyer signs.
            </p>
          </div>
          <div className="overflow-hidden rounded-[4px] border border-line/[0.08] bg-card">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Active reserve margin schedule</caption>
              <thead className="bg-panel">
                <tr>
                  <th className="px-4 py-3 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-dim sm:px-5">
                    Token value
                  </th>
                  <th className="px-4 py-3 text-right font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-dim sm:px-5">
                    Reserve margin
                  </th>
                </tr>
              </thead>
              <tbody>
                {feeTiersLoading ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-6 text-[12.5px] text-ink-muted sm:px-5">
                      Reading the active reserve schedule...
                    </td>
                  </tr>
                ) : feeTiersError || !feeTiers?.length ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-6 text-[12.5px] text-ruby sm:px-5">
                      The reserve schedule is temporarily unavailable. Transaction quotes still use
                      the active contract.
                    </td>
                  </tr>
                ) : (
                  feeTiers.map((tier) => (
                    <tr key={tier.tier} className="border-t border-line/[0.06]">
                      <td className="px-4 py-4 text-[12.5px] text-ink-soft sm:px-5">
                        {tier.range}
                      </td>
                      <td className="px-4 py-4 text-right font-mono text-[16px] text-ink sm:px-5">
                        {tier.pct}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Featured */}
      <section className="mx-auto max-w-content border-t border-line/[0.06] px-6 py-20 md:px-10">
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
      <section className="mx-auto max-w-content border-t border-line/[0.06] px-6 py-20 md:px-10">
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
            className="overflow-hidden rounded-[4px] border border-line/[0.08] bg-card"
          >
            {REDEMPTION_STEPS.map(([title, body, terminal], i) => (
              <div
                key={title}
                className={`flex items-start gap-3.5 border-b border-line/[0.06] px-5 py-4 last:border-b-0 ${
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
        <section className="mx-auto max-w-content border-t border-line/[0.06] px-6 py-20 md:px-10">
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
            className="overflow-hidden rounded-[4px] border border-line/[0.08] bg-card"
          >
            {data.auctions.map((a) => (
              <div
                key={a.gem.gemId.toString()}
                className="flex items-center gap-3.5 border-b border-line/[0.06] px-5 py-3.5 last:border-b-0"
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
      <section className="mx-auto max-w-content border-t border-line/[0.06] px-6 py-24 text-center md:px-10">
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

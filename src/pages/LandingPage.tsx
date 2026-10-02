import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { TopNav } from '@/components/layout/TopNav';
import { Footer } from '@/components/layout/Footer';
import { Button } from '@/components/ui/Button';
import { GemCard } from '@/components/gem/GemCard';
import { GemThumb } from '@/components/gem/GemThumb';
import { CountdownBadge } from '@/components/ui/CountdownBadge';
import { ownershipPathSteps } from '@/content/ownershipPath';
import { useFeeTiers, useLanding } from '@/hooks/useData';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import { displayVaultCount } from './vaultStats';

import { SceneBoundary } from '@/components/three/SceneBoundary';

const GemScene = lazy(() =>
  import('@/components/three/GemScene').then((m) => ({ default: m.GemScene })),
);

const CUSTODY_BENEFITS = [
  {
    title: 'Trade with confidence',
    body: 'Each gemstone is held in a secure vault and remains protected from the moment it is independently valued.',
  },
  {
    title: 'Redeem the gemstone',
    body: 'Token owners can request redemption at anytime and receive the physical gemstone represented by their Token.',
  },
];

const REDEMPTION_STEPS: [string, string, boolean?][] = [
  [
    'Reserve confirmed',
    'The token’s reserve is checked to ensure all redemption costs are covered.',
  ],
  ['Compliance cleared.', 'Your wallet address is verified and approved for redemption.'],
  [
    'Token locked',
    'The token is locked and can no longer be traded while redemption is in progress.',
  ],
  ['Gemstone released', 'The custodian releases your gemstone and confirms the handover on-chain'],
  [
    'Token Burned',
    'Once the gemstone is released, the token is permanently burned. Your digital claim has become a physical gemstone.',
    true,
  ],
];

const RESERVE_COSTS = [
  'Vault fees: 0.05% per month',
  'Insurance fees: 0.1% per month',
  'Transaction fees',
  'Redemption costs',
] as const;

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
            {displayVaultCount(data?.gemsInVault)} stones under custody
          </div>
          <h1 className="max-w-[14ch] font-display text-[43px] font-medium leading-[0.98] tracking-[-0.055em] text-ink sm:text-[54px] md:text-[66px]">
            Trade gemstones. Own them securely.
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-[1.75] text-ink-muted sm:text-[16px]">
            Each Digital Carat Token represent a specific, verified gemstone.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link to="/marketplace" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto">
                Browser marketplace
              </Button>
            </Link>
            <Link to="/seller" className="w-full sm:w-auto">
              <Button variant="ghost" size="lg" className="w-full sm:w-auto">
                Start Seller KYC
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
              Secure Custody
            </h2>
            <p className="mt-3 max-w-[48ch] text-[13.5px] leading-relaxed text-ink-muted">
              Third Party Custody protects both buyers and sellers and ensures that every Tokens
              remains securely linked to its gemstone.
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
        </div>
      </section>

      {/* Gates. Each step is enforced by a different role. */}
      <section className="mx-auto max-w-content border-t border-line/[0.06] px-6 py-20 md:px-10">
        <div data-reveal className="mb-10">
          <h2 className="max-w-[20ch] font-display text-[30px] font-medium tracking-[-0.035em] text-ink md:text-[36px]">
            Lifecycle of the Token
          </h2>
          <p className="mt-3 max-w-[72ch] text-[14px] leading-relaxed text-ink-muted">
            Before a gemstone becomes a Digital Carat Token, it goes through a structured process
            designed to verify its source, characteristics, value and secure custody.
          </p>
        </div>
        <div
          data-reveal
          className="overflow-hidden rounded-[4px] border border-line/[0.08] bg-card"
        >
          {ownershipPathSteps.map((step) => (
            <div
              key={step.num}
              className="grid gap-3 border-b border-line/[0.06] p-5 last:border-b-0 sm:grid-cols-[42px_minmax(0,0.8fr)_minmax(0,1.2fr)] sm:gap-5 sm:p-6"
            >
              <div className="font-mono text-[10px] tracking-[0.1em] text-ink-dim">{step.num}</div>
              <div>
                <h3 className="font-display text-[15px] font-medium tracking-[-0.015em] text-ink">
                  {step.title}
                </h3>
              </div>
              <div>
                {step.body && (
                  <p className="text-[12.5px] leading-relaxed text-ink-muted">{step.body}</p>
                )}
                {step.sections && (
                  <div className={`${step.body ? 'mt-4' : ''} grid gap-4 sm:grid-cols-2`}>
                    {step.sections.map((section) => (
                      <div key={`${section.heading ?? ''}-${section.body}`}>
                        {section.heading && (
                          <h4 className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-dim">
                            {section.heading}
                          </h4>
                        )}
                        <p
                          className={`${section.heading ? 'mt-1' : ''} border-l border-atelier/45 pl-3 text-[11.5px] leading-relaxed text-ink-dim`}
                        >
                          {section.body}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Reserve model */}
      <section className="mx-auto max-w-content border-t border-line/[0.06] px-6 py-20 md:px-10">
        <div data-reveal className="overflow-hidden rounded-[4px] border border-line/[0.1] bg-card">
          <div className="grid lg:grid-cols-[1.02fr_.98fr]">
            <div className="p-6 sm:p-8 lg:p-10">
              <div aria-hidden className="mb-6 h-px w-12 bg-emerald" />
              <h2 className="max-w-[19ch] font-display text-[30px] font-medium tracking-[-0.035em] text-ink md:text-[36px]">
                How the reserve works
              </h2>
              <p className="mt-4 max-w-[54ch] text-[14px] leading-relaxed text-ink-muted">
                When a gemstone is first tokenized, a reserve is added to its approved value:
              </p>

              <div className="mt-7 border-y border-line/[0.1]">
                <p className="grid gap-1 py-4 text-[12.5px] text-ink-soft sm:grid-cols-[1fr_auto] sm:items-baseline sm:gap-6">
                  <span>Gemstones under 1,000 $</span>
                  <span className="font-mono font-semibold text-emerald">-&gt; 15% reserve</span>
                </p>
                <p className="grid gap-1 border-t border-line/[0.08] py-4 text-[12.5px] text-ink-soft sm:grid-cols-[1fr_auto] sm:items-baseline sm:gap-6">
                  <span>Gemstones of 1,000 $ and above</span>
                  <span className="font-mono font-semibold text-emerald">-&gt; 10%</span>
                </p>
              </div>

              <p className="mt-6 max-w-[54ch] text-[13px] leading-relaxed text-ink-muted">
                This reserve is held to cover costs associated with the Token throughout its
                lifecycle.
              </p>
            </div>

            <div className="border-t border-line/[0.08] bg-panel/45 p-6 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
              <h3 className="max-w-[22ch] font-display text-[22px] font-medium tracking-[-0.025em] text-ink">
                One Reserve, Multiple Cost
              </h3>
              <p className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">
                The reserve can be used to cover:
              </p>

              <ul className="mt-6 grid border-y border-line/[0.1] sm:grid-cols-2">
                {RESERVE_COSTS.map((cost, index) => {
                  const [label, detail] = cost.split(': ');
                  return (
                    <li
                      key={cost}
                      className={`min-h-20 py-4 sm:px-4 ${
                        index % 2 === 1 ? 'sm:border-l sm:border-line/[0.08]' : ''
                      } ${index > 1 ? 'border-t border-line/[0.08]' : ''}`}
                    >
                      <span className="block text-[12.5px] font-semibold text-ink">{label}</span>
                      {detail && (
                        <span className="mt-1 block font-mono text-[11px] text-ink-dim">
                          {detail}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>

              <p className="mt-5 border-l-2 border-emerald pl-4 text-[12px] leading-relaxed text-ink-muted">
                Transaction fees are always charged to the party initiating the transaction.
              </p>

              <div className="mt-8 border-t border-line/[0.1] pt-6">
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">Active reserve margin schedule</caption>
                  <thead>
                    <tr>
                      <th className="pb-3 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-dim">
                        Active contract schedule
                      </th>
                      <th className="pb-3 text-right font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-dim">
                        Reserve margin
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {feeTiersLoading ? (
                      <tr>
                        <td
                          colSpan={2}
                          className="border-t border-line/[0.08] py-4 text-[12px] text-ink-muted"
                        >
                          Reading the active reserve schedule...
                        </td>
                      </tr>
                    ) : feeTiersError || !feeTiers?.length ? (
                      <tr>
                        <td
                          colSpan={2}
                          className="border-t border-line/[0.08] py-4 text-[12px] text-ruby"
                        >
                          The reserve schedule is temporarily unavailable. Transaction quotes still
                          use the active contract.
                        </td>
                      </tr>
                    ) : (
                      feeTiers.map((tier) => (
                        <tr key={tier.tier} className="border-t border-line/[0.08]">
                          <td className="py-3 text-[12px] text-ink-soft">{tier.range}</td>
                          <td className="py-3 text-right font-mono text-[15px] font-semibold text-ink">
                            {tier.pct}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid gap-3 border-t border-line/[0.08] bg-panel/30 p-6 sm:p-8 md:grid-cols-[0.62fr_1.38fr] md:gap-10 lg:px-10">
            <h4 className="font-display text-[16px] font-medium leading-snug text-ink">
              What happens to the remaining reserve?
            </h4>
            <p className="max-w-[68ch] text-[12.5px] leading-relaxed text-ink-muted">
              When a gemstone is redeemed, any remaining reserve balance is returned to the token
              holder’s wallet when the token is burned.
            </p>
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
              Turn your digital claim into a physical gemstone
            </h2>
            <p className="mt-3 max-w-[56ch] text-[14px] leading-relaxed text-ink-muted">
              Every Digital Carat token is backed by a specific gemstone. When you request your
              stone, the token is locked, the custodian releases and ships the gemstone, and the
              token is permanently burned.
            </p>
            <p className="mt-3 text-[12px] font-semibold italic tracking-[0.04em] text-ink">
              THE CLAIM BECOMES THE STONE
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
                <GemThumb
                  gem={a.gem}
                  height={40}
                  rounded="rounded-[4px]"
                  showTag={false}
                  showCarat={false}
                  className="w-10 shrink-0"
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

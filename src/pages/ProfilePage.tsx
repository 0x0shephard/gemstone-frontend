import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import {
  usePendingReserveCredits,
  usePendingTreasuryPayout,
  useProfile,
  useSwaps,
} from '@/hooks/useData';
import { SwapCard } from '@/pages/SwapsPage';
import { useAuth } from '@/providers/AuthProvider';
import { useKyc } from '@/hooks/useKyc';
import { StatTile } from '@/components/ui/StatTile';
import { Tabs, type TabDef } from '@/components/ui/Tabs';
import { GemCard } from '@/components/gem/GemCard';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { TransactionHistory } from '@/components/tx/TransactionHistory';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { KycStatus } from '@/components/kyc/KycStatus';
import { CountdownBadge } from '@/components/ui/CountdownBadge';
import { GemThumb } from '@/components/gem/GemThumb';
import { Card } from '@/components/ui/Card';
import { CardGridSkeleton, EmptyState } from '@/components/ui/States';
import { fmtUsd, shortenAddress } from '@/lib/format';
import { WalletAddress } from '@/components/wallet/WalletAddress';
import type { Bid, Offer, PendingReserveCredit } from '@/services/types';
import { AnalyticsConsent } from '@/components/privacy/AnalyticsConsent';
import { PendingRefunds } from '@/components/wallet/PendingRefunds';
import { TxButton } from '@/components/tx/TxButton';
import { Button } from '@/components/ui/Button';
import { GemActionModals } from '@/components/modals/GemActionModals';
import { GiftCardList } from '@/components/gift/GiftCardList';
import { useGemModals } from '@/hooks/useGemModals';
import { dataService } from '@/services';
import { isAddress, isAddressEqual, type Address } from 'viem';

const TABS = ['owned', 'bids', 'offers', 'swaps', 'gifts', 'redeem', 'history'] as const;
type Tab = (typeof TABS)[number];

export default function ProfilePage() {
  const { address } = useAccount();
  const { user } = useAuth();
  const { status: kyc } = useKyc();
  const { data: profile, isLoading, isError, error, refetch } = useProfile(address);
  const { data: pendingProceeds, refetch: refetchPendingProceeds } =
    usePendingTreasuryPayout(address);
  const { data: reserveCredits, refetch: refetchReserveCredits } =
    usePendingReserveCredits(address);
  const modals = useGemModals();
  /*
   * Deep-linkable so the mobile dock's "Token Bids" can land directly on that
   * tab. Kept in the URL rather than local state alone, otherwise the dock entry
   * and the Portfolio entry would be indistinguishable destinations.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : 'owned';
  const setTab = (next: Tab) =>
    setSearchParams(next === 'owned' ? {} : { tab: next }, { replace: true });

  const name = (user?.user_metadata?.full_name as string) || user?.email || 'Guest';
  const redemptionTokenIds = new Set(
    (profile?.redemptions ?? []).map((redemption) => redemption.tokenId.toString()),
  );

  /*
   * "Bids" means two different things in this protocol and the old labels did
   * not distinguish them: `bids` are auction bids placed while a stone is still
   * unminted, and `offers` are bids on an already-minted token.
   */
  const tabs: TabDef<Tab>[] = [
    { key: 'owned', label: 'Owned Tokens', count: profile?.owned.length ?? 0 },
    { key: 'bids', label: 'Minting Bids', count: profile?.bids.length ?? 0 },
    { key: 'offers', label: 'Token Bids', count: profile?.offers.length ?? 0 },
    { key: 'swaps', label: 'Swaps', count: profile?.swaps.length ?? 0 },
    { key: 'gifts', label: 'Gift Cards', count: '—' },
    { key: 'redeem', label: 'Redemption', count: profile?.redemptions.length ?? 0 },
    { key: 'history', label: 'History', count: '—' },
  ];
  const sectionKey =
    tab === 'owned'
      ? 'holdings'
      : tab === 'redeem'
        ? 'redemptions'
        : tab === 'history'
          ? 'activity'
          : tab === 'gifts'
            ? undefined
            : tab;
  const section = sectionKey && profile?.sections[sectionKey];

  return (
    <div className="space-y-6">
      {/* Identity */}
      <Card className="dc-facet-border relative flex flex-wrap items-center justify-between gap-5 overflow-hidden p-5 sm:p-6">
        <div className="dc-dot-grid pointer-events-none absolute inset-y-0 right-0 w-1/3 opacity-40" />
        <div className="relative flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-[4px] border border-line/[0.11] bg-line/[0.04] font-display text-[14px] font-medium text-ink">
            {name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="font-display text-[18px] font-medium tracking-[-0.02em] text-ink">
              {name}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-dim">
              {user?.email ?? 'Public browsing session'}
            </div>
          </div>
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          <StatusBadge tone={user ? 'success' : 'neutral'} dot>
            {user ? 'Email verified' : 'Not signed in'}
          </StatusBadge>
          <KycStatus status={kyc} />
        </div>
      </Card>

      <PendingRefunds />

      {address && reserveCredits && reserveCredits.length > 0 && (
        <ReserveCreditsCard
          beneficiary={address}
          credits={reserveCredits}
          onConfirmed={() => refetchReserveCredits().then(() => undefined)}
        />
      )}

      {address && pendingProceeds && (
        <Card className="dc-facet-border flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald">
              Primary sale proceeds
            </div>
            <div className="mt-1 font-display text-[21px] font-medium text-ink">
              {pendingProceeds.amountFmt} ready to claim
            </div>
            <p className="mt-1 text-[12px] text-ink-muted">
              Native proceeds accrue safely and are withdrawn to your connected wallet.
            </p>
          </div>
          <TxButton
            action={() => dataService.claimTreasuryPayout({ recipient: address })}
            onConfirmed={() => refetchPendingProceeds().then(() => undefined)}
            pendingLabel="Claiming proceeds…"
            telemetryFlow="treasury_claim"
          >
            Claim proceeds
          </TxButton>
        </Card>
      )}

      {/*
        Which wallet these figures describe. Every number on this page is read
        from the connected address, so naming it is the difference between
        "my tokens are missing" and "I am looking at the wrong wallet".
      */}
      {address ? (
        <Card className="p-4">
          <WalletAddress address={address} label="Portfolio is reading this wallet" />
        </Card>
      ) : (
        <Card className="p-4">
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            No wallet is connected, so this page has nothing to read. Connect the wallet that holds
            your tokens — signing in alone does not link one.
          </p>
        </Card>
      )}

      {/*
        A failed read is not an empty portfolio, and until now the two looked
        identical: every figure below falls back to zero when `profile` is
        undefined, so a chain that could not be reached rendered as a wallet that
        owns nothing. Telling someone they hold no tokens when the truth is that
        nobody could find out is the worst of the two mistakes.
      */}
      {isError && (
        <Card className="border-ruby/25 bg-ruby/[0.05] p-4">
          <h3 className="text-[13px] font-semibold text-ink">Your portfolio could not be read</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            This is a problem reaching the chain, not a statement about what you own — nothing below
            is reliable until it succeeds.
          </p>
          {error instanceof Error && (
            <p className="mt-2 break-words font-mono text-[11px] text-ink-dim">{error.message}</p>
          )}
          <button
            type="button"
            onClick={() => void refetch()}
            className="dc-btn-anim mt-3 h-9 rounded-[4px] border border-line/[0.12] px-3 text-[12px] font-semibold text-ink"
          >
            Try again
          </button>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="Portfolio value" value={fmtUsd(profile?.stats.portfolioValueUsd ?? 0)} />
        <StatTile label="Owned Tokens" value={profile?.stats.ownedCount ?? 0} />
        <StatTile label="Minting Bids" value={profile?.stats.activeBids ?? 0} />
        {/* Counted from the lists themselves; `stats` carries no offer or swap total. */}
        <StatTile label="Token Bids" value={profile?.offers.length ?? 0} />
        <StatTile label="Swaps" value={profile?.swaps.length ?? 0} />
        <StatTile
          label="Reserve shortfall"
          value={fmtUsd(profile?.stats.reserveShortfallUsd ?? 0)}
          valueColor={
            profile && profile.stats.reserveShortfallUsd > 0 ? 'var(--dc-amber)' : undefined
          }
        />
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {section && section.state !== 'ready' && (
        <Card
          className={
            section.state === 'error'
              ? 'border-ruby/25 bg-ruby/[0.05] p-3.5'
              : 'border-amber/25 bg-amber/[0.05] p-3.5'
          }
        >
          <p className="text-[12px] leading-relaxed text-ink-muted">
            {section.message ??
              (section.state === 'syncing'
                ? 'This section is still syncing from the chain.'
                : 'This section is showing the data that could be verified so far.')}
          </p>
          {section.state === 'error' && (
            <button
              type="button"
              onClick={() => void refetch()}
              className="dc-btn-anim mt-2 h-8 rounded-[4px] border border-line/[0.12] px-3 text-[11.5px] font-semibold text-ink"
            >
              Retry this section
            </button>
          )}
        </Card>
      )}

      {/* Tab content */}
      {isLoading ? (
        <CardGridSkeleton count={4} />
      ) : !profile ? (
        <EmptyState title="No data" />
      ) : (
        <div className="animate-dcfade">
          {tab === 'owned' &&
            (profile.owned.length ? (
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
                {profile.owned.map((g) => (
                  <GemCard
                    key={g.gemId.toString()}
                    gem={g}
                    ctaLabel={g.listingSeller ? 'Manage listing →' : 'Manage →'}
                    href={`/gem/${g.gemId}?manage=1${g.listingSeller ? '&listed=1' : ''}`}
                    footer={
                      /*
                       * A listed token is escrowed by the Marketplace, so there
                       * is nothing here to send until the listing is cancelled.
                       */
                      g.tokenId &&
                      !g.listingSeller &&
                      !redemptionTokenIds.has(g.tokenId.toString()) &&
                      address &&
                      g.owner &&
                      isAddressEqual(g.owner, address) ? (
                        <Button
                          block
                          size="sm"
                          variant="secondary"
                          onClick={() => modals.open('send', g)}
                        >
                          Send token
                        </Button>
                      ) : null
                    }
                  />
                ))}
              </div>
            ) : (
              /*
                A token sent to a wallet the visitor has not connected is not
                missing — it is simply not being looked at. Saying "buy your
                first gem" to someone who already owns one, because they
                connected a different wallet or none at all, sends them looking
                for a bug that is not there.
              */
              <EmptyState
                title={address ? 'Nothing in this wallet' : 'No wallet connected'}
                hint={
                  address
                    ? `Your portfolio shows tokens held by ${shortenAddress(address)}. If someone sent you a token, make sure this is the wallet they sent it to.`
                    : 'Connect the wallet that holds your tokens — your portfolio reads directly from it.'
                }
              />
            ))}

          {tab === 'bids' && <BidsTable rows={profile.bids} />}
          {tab === 'offers' && <OffersTable rows={profile.offers} address={address} />}

          {/*
            The same actionable cards as the Swaps page: accept a swap proposed
            to you, cancel one you proposed, or recover an expired one — from
            here, without going through the gem's Manage screen.
          */}
          {tab === 'swaps' && <PortfolioSwaps viewer={address} />}

          {tab === 'gifts' && <GiftCardList owned={profile.owned} />}

          {tab === 'redeem' &&
            (profile.redemptions.length ? (
              <div className="space-y-3">
                {profile.redemptions.map((r, i) => {
                  return (
                    <Card key={i} className="p-4">
                      <div className="flex items-center gap-3">
                        <GemThumb
                          gem={r.gem}
                          height={44}
                          rounded="rounded-[4px]"
                          showTag={false}
                          showCarat={false}
                          className="w-11"
                        />
                        <div className="flex-1">
                          <div className="text-[14px] font-semibold text-ink">{r.gem.name}</div>
                          <div className="text-[12px] text-ink-muted">{r.stage}</div>
                        </div>
                        <StatusBadge color={r.statusColor} dot>
                          {r.status}
                        </StatusBadge>
                      </div>

                      <div className="mt-3 flex flex-col gap-2.5 border-t border-line/[0.06] pt-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-[11.5px] leading-relaxed text-ink-dim">
                          Physical custody, delivery proof, owner authorization and final burn are
                          tracked together on the canonical redemption page.
                        </p>
                        <Link
                          to="/redeem"
                          className="shrink-0 text-[12px] font-semibold text-atelier underline underline-offset-2"
                        >
                          Open redemption tracker
                        </Link>
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="No redemption requests" />
            ))}

          {tab === 'history' && <TransactionHistory items={profile.activity} />}
        </div>
      )}

      <AnalyticsConsent />
      <GemActionModals state={modals.state} onClose={modals.close} />
    </div>
  );
}

export function ReserveCreditsCard({
  beneficiary,
  credits,
  onConfirmed,
}: {
  beneficiary: Address;
  credits: PendingReserveCredit[];
  onConfirmed: () => void | Promise<void>;
}) {
  const [recipient, setRecipient] = useState<string>(beneficiary);
  useEffect(() => setRecipient(beneficiary), [beneficiary]);
  const recipientIsValid = isAddress(recipient);

  const claim = (credit: PendingReserveCredit) => {
    if (!isAddress(recipient)) {
      return Promise.reject(new Error('Enter a valid EVM wallet address for the recipient.'));
    }
    return dataService.claimReserveCredit({
      paymentAsset: credit.paymentAsset,
      recipient,
    });
  };

  return (
    <Card className="dc-facet-border p-5">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sapphire">
          Redeemed-token reserve
        </div>
        <div className="mt-1 font-display text-[21px] font-medium text-ink">
          Reserve credit ready to claim
        </div>
        <p className="mt-1 max-w-[62ch] text-[12px] leading-relaxed text-ink-muted">
          Only the connected holder wallet can authorize this claim. Choose where to receive it; use
          another EOA if the connected smart wallet cannot accept native funds or tokens.
        </p>
      </div>

      <label
        htmlFor="reserve-credit-recipient"
        className="mt-4 block text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-dim"
      >
        Recipient wallet
      </label>
      <input
        id="reserve-credit-recipient"
        value={recipient}
        onChange={(event) => setRecipient(event.target.value.trim())}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={!recipientIsValid}
        className="mt-1.5 h-10 w-full rounded-[4px] border border-line/[0.12] bg-line/[0.03] px-3 font-mono text-[12px] text-ink outline-none focus:border-sapphire/50"
      />
      {!recipientIsValid && (
        <p role="alert" className="mt-1.5 text-[11px] text-ruby">
          Enter a valid EVM wallet address.
        </p>
      )}

      <div className="mt-4 divide-y divide-line/[0.06] border-t border-line/[0.06]">
        {credits.map((credit) => (
          <div
            key={credit.paymentAsset}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <div className="font-mono text-[15px] font-semibold tracking-[-0.02em] text-ink">
                {credit.amountFmt}
              </div>
              <div className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-dim">
                {credit.symbol}
              </div>
            </div>
            <TxButton
              size="sm"
              action={() => claim(credit)}
              onConfirmed={onConfirmed}
              disabled={!recipientIsValid}
              pendingLabel="Claiming reserve…"
              telemetryFlow="reserve_credit_claim"
            >
              Claim {credit.symbol}
            </TxButton>
          </div>
        ))}
      </div>
    </Card>
  );
}

const bidColumns: Column<Bid>[] = [
  {
    key: 'gem',
    header: 'Gem',
    render: (r) => (
      <span>
        {r.gem.name}{' '}
        <span className="font-mono text-[11.5px] text-ink-dim">· {r.gem.displayId}</span>
      </span>
    ),
  },
  { key: 'my', header: 'My bid', align: 'right', mono: true, render: (r) => r.myBidFmt },
  { key: 'top', header: 'Top bid', align: 'right', mono: true, render: (r) => r.topBidFmt },
  {
    key: 'status',
    header: 'Status',
    render: (r) => (
      <StatusBadge color={r.statusColor} dot>
        {r.status}
      </StatusBadge>
    ),
  },
  {
    key: 'time',
    header: 'Time left',
    align: 'right',
    render: (r) => <CountdownBadge seconds={r.secondsLeft} />,
  },
];

function BidsTable({ rows }: { rows: Bid[] }) {
  return (
    <DataTable
      columns={bidColumns}
      rows={rows}
      rowKey={(r) => r.gem.gemId.toString()}
      empty="No active bids."
    />
  );
}

function offerColumns(address?: string): Column<Offer>[] {
  const normalized = address?.toLowerCase();
  return [
    {
      key: 'gem',
      header: 'Gem',
      render: (r) => (
        <span>
          {r.gem.name}{' '}
          <span className="font-mono text-[11.5px] text-ink-dim">· {r.gem.displayId}</span>
        </span>
      ),
    },
    { key: 'offer', header: 'Offer', align: 'right', mono: true, render: (r) => r.offerFmt },
    { key: 'from', header: 'From', mono: true, render: (r) => r.from },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <StatusBadge
          color={r.statusColor}
          dot={r.status === 'Pending' || r.status === 'Awaiting settlement'}
        >
          {r.status}
        </StatusBadge>
      ),
    },
    {
      key: 'exp',
      header: 'Expiry',
      align: 'right',
      render: (r) =>
        r.secondsLeft > 0 ? (
          <CountdownBadge seconds={r.secondsLeft} />
        ) : (
          <span className="text-ink-dim">Expired</span>
        ),
    },
    {
      key: 'action',
      header: '',
      align: 'right',
      render: (r) => {
        const isBidder = normalized === r.bidder.toLowerCase();
        const isOwner = normalized === r.tokenOwner.toLowerCase();
        if (r.status === 'Awaiting settlement' && r.gem.tokenId) {
          return (
            <TxButton
              size="sm"
              variant="secondary"
              action={() => dataService.settleListingAuction({ tokenId: r.gem.tokenId! })}
              pendingLabel="Settling…"
              telemetryFlow="listed_token_auction_settle"
            >
              Settle now
            </TxButton>
          );
        }
        if (r.status === 'Expired' && isBidder) {
          return (
            <TxButton
              size="sm"
              variant="ghost"
              action={() => dataService.refundExpiredOffer({ offerId: r.offerId })}
              pendingLabel="Refunding…"
              telemetryFlow="offer_refund"
            >
              Claim refund
            </TxButton>
          );
        }
        if (r.status === 'Pending' && isOwner && !r.automatic) {
          return (
            <TxButton
              size="sm"
              variant="secondary"
              action={() => dataService.acceptOffer({ offerId: r.offerId })}
              pendingLabel="Accepting…"
              telemetryFlow="offer_accept"
            >
              Accept
            </TxButton>
          );
        }
        if (r.status === 'Pending' && r.automatic) {
          return <span className="text-[11px] text-ink-dim">Settles automatically</span>;
        }
        return null;
      },
    },
  ];
}

function OffersTable({ rows, address }: { rows: Offer[]; address?: string }) {
  return (
    <DataTable
      columns={offerColumns(address)}
      rows={rows}
      rowKey={(r) => r.offerId.toString()}
      empty="No offers."
    />
  );
}

function PortfolioSwaps({ viewer }: { viewer?: Address }) {
  const { data: swaps, isLoading } = useSwaps();
  if (isLoading && !swaps) return <CardGridSkeleton count={2} />;
  const mine = (swaps ?? []).filter(
    (swap) =>
      viewer &&
      (swap.proposer.toLowerCase() === viewer.toLowerCase() ||
        swap.requestedOwner.toLowerCase() === viewer.toLowerCase()),
  );
  if (!mine.length) return <EmptyState title="No swap requests" />;
  return (
    <div className="space-y-3">
      {mine.map((swap) => (
        <SwapCard key={swap.offerId.toString()} swap={swap} viewer={viewer} />
      ))}
    </div>
  );
}

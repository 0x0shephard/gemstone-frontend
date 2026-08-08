import { useSearchParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { usePendingTreasuryPayout, useProfile } from '@/hooks/useData';
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
import { fmtUsd } from '@/lib/format';
import type { Bid, Offer } from '@/services/types';
import { AnalyticsConsent } from '@/components/privacy/AnalyticsConsent';
import { PendingRefunds } from '@/components/wallet/PendingRefunds';
import { TxButton } from '@/components/tx/TxButton';
import { Button } from '@/components/ui/Button';
import { GemActionModals } from '@/components/modals/GemActionModals';
import { GiftCardList } from '@/components/gift/GiftCardList';
import { useGemModals } from '@/hooks/useGemModals';
import { dataService } from '@/services';

const TABS = ['owned', 'bids', 'offers', 'swaps', 'gifts', 'redeem', 'history'] as const;
type Tab = (typeof TABS)[number];

export default function ProfilePage() {
  const { address } = useAccount();
  const { user } = useAuth();
  const { status: kyc } = useKyc();
  const { data: profile, isLoading } = useProfile(address);
  const { data: pendingProceeds, refetch: refetchPendingProceeds } =
    usePendingTreasuryPayout(address);
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
            action={async () => {
              const result = await dataService.claimTreasuryPayout({ recipient: address });
              await refetchPendingProceeds();
              return result;
            }}
            pendingLabel="Claiming proceeds…"
            telemetryFlow="treasury_claim"
          >
            Claim proceeds
          </TxButton>
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
                      g.tokenId && !g.listingSeller ? (
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
              <EmptyState title="No gems yet" hint="Buy your first gem in the marketplace." />
            ))}

          {tab === 'bids' && <BidsTable rows={profile.bids} />}
          {tab === 'offers' && <OffersTable rows={profile.offers} address={address} />}

          {tab === 'swaps' &&
            (profile.swaps.length ? (
              <div className="space-y-3">
                {profile.swaps.map((s, i) => (
                  <Card key={i} className="flex items-center gap-3 p-4">
                    <GemThumb
                      gem={s.gem}
                      height={44}
                      rounded="rounded-[4px]"
                      showTag={false}
                      showCarat={false}
                      className="w-11"
                    />
                    <div className="flex-1">
                      <div className="text-[14px] font-semibold text-ink">
                        {s.giveName} <span className="text-ink-dim">⇄</span> {s.gem.name}
                      </div>
                      <div className="text-[12px] text-emerald">{s.diff}</div>
                    </div>
                    <StatusBadge color={s.statusColor} dot>
                      {s.status}
                    </StatusBadge>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState title="No swap requests" />
            ))}

          {tab === 'gifts' && <GiftCardList owned={profile.owned} />}

          {tab === 'redeem' &&
            (profile.redemptions.length ? (
              <div className="space-y-3">
                {profile.redemptions.map((r, i) => (
                  <Card key={i} className="flex items-center gap-3 p-4">
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
                  </Card>
                ))}
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
        <StatusBadge color={r.statusColor} dot={r.status === 'Pending'}>
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
        if (r.status === 'Pending' && isOwner) {
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
        if (r.status === 'Pending' && normalized === r.listingSeller?.toLowerCase()) {
          return <span className="text-[11px] text-ink-dim">Cancel listing before accepting</span>;
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

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useProfile } from '@/hooks/useData';
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
import type { Bid, Offer } from '@/services/types';

type Tab = 'owned' | 'bids' | 'offers' | 'swaps' | 'redeem' | 'history';

export default function ProfilePage() {
  const { address } = useAccount();
  const { user, linkedWallet } = useAuth();
  const { status: kyc } = useKyc();
  const { data: profile, isLoading } = useProfile(address);
  const [tab, setTab] = useState<Tab>('owned');

  const name = (user?.user_metadata?.full_name as string) || user?.email || 'Guest';

  const tabs: TabDef<Tab>[] = [
    { key: 'owned', label: 'Owned gems', count: profile?.owned.length ?? 0 },
    { key: 'bids', label: 'Active bids', count: profile?.bids.length ?? 0 },
    { key: 'offers', label: 'Offers', count: profile?.offers.length ?? 0 },
    { key: 'swaps', label: 'Swap requests', count: profile?.swaps.length ?? 0 },
    { key: 'redeem', label: 'Redemption', count: profile?.redemptions.length ?? 0 },
    { key: 'history', label: 'History', count: '—' },
  ];

  return (
    <div className="space-y-6">
      {/* Identity */}
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <div className="text-[17px] font-bold text-ink">{name}</div>
          <div className="mt-0.5 font-mono text-[12px] text-ink-dim">
            {shortenAddress(address ?? linkedWallet)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={user ? 'success' : 'neutral'} dot>
            {user ? 'Email verified' : 'Not signed in'}
          </StatusBadge>
          <KycStatus status={kyc} />
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Portfolio value" value={fmtUsd(profile?.stats.portfolioValueUsd ?? 0)} />
        <StatTile label="Owned gems" value={profile?.stats.ownedCount ?? 0} />
        <StatTile label="Active bids" value={profile?.stats.activeBids ?? 0} />
        <StatTile
          label="Reserve shortfall"
          value={fmtUsd(profile?.stats.reserveShortfallUsd ?? 0)}
          valueColor={profile && profile.stats.reserveShortfallUsd > 0 ? '#E5A23C' : undefined}
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
                  <GemCard key={g.id} gem={g} ctaLabel="Manage →" />
                ))}
              </div>
            ) : (
              <EmptyState title="No gems yet" hint="Buy your first gem in the marketplace." />
            ))}

          {tab === 'bids' && <BidsTable rows={profile.bids} />}
          {tab === 'offers' && <OffersTable rows={profile.offers} />}

          {tab === 'swaps' &&
            (profile.swaps.length ? (
              <div className="space-y-3">
                {profile.swaps.map((s, i) => (
                  <Card key={i} className="flex items-center gap-3 p-4">
                    <GemThumb gem={s.gem} height={44} rounded="rounded-[10px]" showTag={false} showCarat={false} className="w-11" />
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

          {tab === 'redeem' &&
            (profile.redemptions.length ? (
              <div className="space-y-3">
                {profile.redemptions.map((r, i) => (
                  <Card key={i} className="flex items-center gap-3 p-4">
                    <GemThumb gem={r.gem} height={44} rounded="rounded-[10px]" showTag={false} showCarat={false} className="w-11" />
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
    </div>
  );
}

const bidColumns: Column<Bid>[] = [
  { key: 'gem', header: 'Gem', render: (r) => (
    <span>{r.gem.name} <span className="font-mono text-[11.5px] text-ink-dim">· {r.gem.gemId}</span></span>
  ) },
  { key: 'my', header: 'My bid', align: 'right', mono: true, render: (r) => r.myBidFmt },
  { key: 'top', header: 'Top bid', align: 'right', mono: true, render: (r) => r.topBidFmt },
  { key: 'status', header: 'Status', render: (r) => <StatusBadge color={r.statusColor} dot>{r.status}</StatusBadge> },
  { key: 'time', header: 'Time left', align: 'right', render: (r) => <CountdownBadge seconds={r.secondsLeft} /> },
];

function BidsTable({ rows }: { rows: Bid[] }) {
  return <DataTable columns={bidColumns} rows={rows} rowKey={(r) => r.gem.id} empty="No active bids." />;
}

const offerColumns: Column<Offer>[] = [
  { key: 'gem', header: 'Gem', render: (r) => (
    <span>{r.gem.name} <span className="font-mono text-[11.5px] text-ink-dim">· {r.gem.gemId}</span></span>
  ) },
  { key: 'offer', header: 'Offer', align: 'right', mono: true, render: (r) => r.offerFmt },
  { key: 'from', header: 'From', mono: true, render: (r) => r.from },
  { key: 'status', header: 'Status', render: (r) => <StatusBadge color={r.statusColor} dot={r.status === 'Pending'}>{r.status}</StatusBadge> },
  { key: 'exp', header: 'Expiry', align: 'right', render: (r) => (r.secondsLeft > 0 ? <CountdownBadge seconds={r.secondsLeft} /> : <span className="text-ink-dim">Expired</span>) },
];

function OffersTable({ rows }: { rows: Offer[] }) {
  return <DataTable columns={offerColumns} rows={rows} rowKey={(r, i) => `${r.gem.id}-${i}`} empty="No offers." />;
}

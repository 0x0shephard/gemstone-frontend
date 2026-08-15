import { useProfile, useRedemptions } from '@/hooks/useData';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { GemThumb } from '@/components/gem/GemThumb';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { TxButton } from '@/components/tx/TxButton';
import { Skeleton } from '@/components/ui/States';
import { GemActionModals } from '@/components/modals/GemActionModals';
import { useGemModals } from '@/hooks/useGemModals';
import { dataService } from '@/services';
import { cn } from '@/lib/cn';

const STEPS = [
  {
    n: '01',
    title: 'Verify ownership',
    body: 'Confirm you hold the token and the reserve is fully funded.',
  },
  {
    n: '02',
    title: 'Compliance check',
    body: 'Your address must not be blocked. No identity verification is required to redeem.',
  },
  {
    n: '03',
    title: 'Request & lock',
    body: 'requestRedemption locks the NFT pending custodian confirmation.',
  },
  {
    n: '04',
    title: 'Burn & release',
    body: 'On confirmation the NFT burns and the physical stone is released.',
    danger: true,
  },
];

export default function RedeemPage() {
  const { data: profile, isLoading } = useProfile();
  const { data: redemptions } = useRedemptions();
  const modals = useGemModals();

  return (
    <div className="space-y-8">
      {/* Process */}
      <section className="overflow-hidden rounded-[4px] border border-line/[0.075] bg-gradient-to-br from-card to-inset p-5 sm:p-6">
        <div className="mb-6 max-w-xl">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-atelier">
            Physical fulfillment
          </p>
          <h2 className="mt-2 font-display text-[23px] font-medium tracking-[-0.03em] text-ink">
            Redemption follows a verifiable custody path.
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
            Your token is locked before the custodian releases the stone, then permanently burned
            when fulfillment is confirmed.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <Card
              key={s.n}
              className={cn('relative p-4', s.danger && 'border-ruby/25')}
              style={
                s.danger
                  ? { background: 'color-mix(in srgb, var(--dc-ruby) 5%, transparent)' }
                  : undefined
              }
            >
              <div className={cn('font-mono text-[11px]', s.danger ? 'text-ruby' : 'text-ink-dim')}>
                {s.n}
              </div>
              <h3 className="mt-3 font-display text-[14px] font-medium text-ink">{s.title}</h3>
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">{s.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* In-progress redemptions */}
      {redemptions && redemptions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[16px] font-semibold text-ink">In progress</h3>
          {redemptions.map((r, i) => (
            <Card key={i} className="p-5">
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
                  <div className="font-mono text-[11.5px] text-ink-dim">{r.gem.displayId}</div>
                </div>
                <StatusBadge color={r.statusColor} dot>
                  {r.status}
                </StatusBadge>
              </div>
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-[12px]">
                  <span className="text-ink-muted">{r.stage}</span>
                  <span className="font-mono text-ink-soft">{r.progress}%</span>
                </div>
                <ProgressBar value={r.progress} funded={false} />
              </div>
              <div className="mt-4 flex justify-end">
                <TxButton
                  size="sm"
                  variant="ghost"
                  action={() => dataService.cancelRedemption({ tokenId: r.tokenId })}
                  pendingLabel="Cancelling…"
                >
                  Cancel redemption
                </TxButton>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Redeemable holdings */}
      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-ink">Redeemable holdings</h3>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <Card className="divide-y divide-line/[0.06] overflow-hidden">
            {profile?.owned
              .filter((gem) => !gem.listingSeller)
              .map((gem) => {
                const canRedeem = gem.funded && gem.redeem === 'Eligible';
                return (
                  <div
                    key={gem.gemId.toString()}
                    className="grid gap-3 p-4 sm:grid-cols-[auto_1fr_auto_auto] sm:items-center"
                  >
                    <GemThumb
                      gem={gem}
                      height={44}
                      rounded="rounded-[4px]"
                      showTag={false}
                      showCarat={false}
                      className="w-11"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-ink">{gem.name}</div>
                      <div className="font-mono text-[11.5px] text-ink-dim">{gem.displayId}</div>
                    </div>
                    <div>
                      {canRedeem ? (
                        <StatusBadge tone="success" dot>
                          Eligible
                        </StatusBadge>
                      ) : gem.redeem === 'Blocked' ? (
                        <StatusBadge tone="danger">Blocked</StatusBadge>
                      ) : (
                        <StatusBadge tone="warning" dot>
                          Reserve short
                        </StatusBadge>
                      )}
                    </div>
                    <div>
                      <Button
                        size="sm"
                        variant={canRedeem ? 'primary' : 'ghost'}
                        disabled={!canRedeem}
                        onClick={() => modals.open('redeem', gem)}
                      >
                        Start redemption
                      </Button>
                    </div>
                  </div>
                );
              })}
          </Card>
        )}
      </div>

      <GemActionModals state={modals.state} onClose={modals.close} />
    </div>
  );
}

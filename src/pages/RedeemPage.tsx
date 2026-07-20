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
  { n: '01', title: 'Verify ownership', body: 'Confirm you hold the token and the reserve is fully funded.' },
  { n: '02', title: 'Compliance check', body: 'ComplianceRegistry.canRedeem must pass for your address.' },
  { n: '03', title: 'Request & lock', body: 'requestRedemption locks the NFT pending custodian confirmation.' },
  { n: '04', title: 'Burn & release', body: 'On confirmation the NFT burns and the physical stone is released.', danger: true },
];

export default function RedeemPage() {
  const { data: profile, isLoading } = useProfile();
  const { data: redemptions } = useRedemptions();
  const modals = useGemModals();

  return (
    <div className="space-y-8">
      {/* Process */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <Card
            key={s.n}
            className={cn('p-5', s.danger && 'border-ruby/30')}
            style={s.danger ? { background: 'rgba(229,72,77,.05)' } : undefined}
          >
            <div className={cn('font-mono text-[13px]', s.danger ? 'text-ruby' : 'text-ink-dim')}>
              {s.n}
            </div>
            <h3 className="mt-3 text-[15px] font-semibold text-ink">{s.title}</h3>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">{s.body}</p>
          </Card>
        ))}
      </div>

      {/* In-progress redemptions */}
      {redemptions && redemptions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[16px] font-semibold text-ink">In progress</h3>
          {redemptions.map((r, i) => (
            <Card key={i} className="p-5">
              <div className="flex items-center gap-3">
                <GemThumb gem={r.gem} height={44} rounded="rounded-[10px]" showTag={false} showCarat={false} className="w-11" />
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-ink">{r.gem.name}</div>
                  <div className="font-mono text-[11.5px] text-ink-dim">{r.gem.gemId}</div>
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
                  action={() => dataService.cancelRedemption(r.gem.id)}
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
          <Card className="divide-y divide-white/[0.06]">
            {profile?.owned.map((gem) => {
              const canRedeem = gem.funded && gem.redeem === 'Eligible';
              return (
                <div key={gem.id} className="flex items-center gap-3 p-4">
                  <GemThumb gem={gem} height={44} rounded="rounded-[10px]" showTag={false} showCarat={false} className="w-11" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-ink">{gem.name}</div>
                    <div className="font-mono text-[11.5px] text-ink-dim">{gem.gemId}</div>
                  </div>
                  {canRedeem ? (
                    <StatusBadge tone="success" dot>
                      Eligible
                    </StatusBadge>
                  ) : gem.redeem === 'KYC required' ? (
                    <StatusBadge tone="danger">KYC required</StatusBadge>
                  ) : (
                    <StatusBadge tone="warning" dot>
                      Reserve short
                    </StatusBadge>
                  )}
                  <Button
                    size="sm"
                    variant={canRedeem ? 'primary' : 'ghost'}
                    disabled={!canRedeem}
                    onClick={() => modals.open('redeem', gem)}
                  >
                    Redeem
                  </Button>
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

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { KycStatus } from '@/components/kyc/KycStatus';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { GemCard } from '@/components/gem/GemCard';
import { WalletStatus } from '@/components/wallet/WalletStatus';
import { useKyc } from '@/hooks/useKyc';
import { useGems } from '@/hooks/useData';

export default function SellerPage() {
  const { status, isApproved, beginKyc, backendConfigured } = useKyc();
  const { isConnected } = useAccount();
  const { data: gems = [] } = useGems();
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: '', carats: '', certHash: '', metadataUri: '' });

  // The wallet's on-chain seller role is unknown in the mock — never claim it.
  const onChainApproved = false;

  return (
    <div className="space-y-6">
      {/* Onboarding status */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-bold text-ink">Seller onboarding</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Selling requires Sumsub KYC and on-chain seller approval via GemRegistry.
            </p>
          </div>
          <KycStatus status={status} />
        </div>

        {!backendConfigured && (
          <p className="mt-4 rounded-[10px] border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-[12px] text-ink-dim">
            KYC backend not configured. Set <span className="font-mono">VITE_SUMSUB_BACKEND_URL</span>{' '}
            — access tokens must be minted server-side, never exposed to the frontend.
          </p>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <StepBadge n="1" label="KYC verification" done={isApproved} />
          <StepBadge n="2" label="Wallet connected" done={isConnected} />
          <StepBadge n="3" label="Protocol approval" done={onChainApproved} pending />
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          {!isApproved && (
            <Button onClick={beginKyc} disabled={status === 'pending'}>
              {status === 'pending' ? 'Verifying…' : 'Start KYC verification'}
            </Button>
          )}
          {!isConnected && <WalletStatus variant="full" />}
        </div>
      </Card>

      {/* Submit gemstone — gated */}
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-ink">Submit a gemstone</h3>
          {!isApproved && <StatusBadge tone="warning">Complete KYC to enable</StatusBadge>}
        </div>

        <fieldset disabled={!isApproved} className="grid gap-3 sm:grid-cols-2" style={{ opacity: isApproved ? 1 : 0.5 }}>
          <Field label="Gem name" placeholder="Burmese Ruby" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Field label="Carats" placeholder="3.12" inputMode="decimal" value={form.carats} onChange={(e) => setForm((f) => ({ ...f, carats: e.target.value }))} />
          <Field label="Certificate hash" placeholder="0x…" value={form.certHash} onChange={(e) => setForm((f) => ({ ...f, certHash: e.target.value }))} />
          <Field label="Metadata URI" placeholder="ipfs://…" value={form.metadataUri} onChange={(e) => setForm((f) => ({ ...f, metadataUri: e.target.value }))} />
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">Notes (off-chain)</span>
            <textarea className={inputClass + ' h-24 resize-none py-2.5'} placeholder="Provenance, grading lab, inclusions…" />
          </label>
        </fieldset>

        <div className="mt-4 flex items-center gap-3">
          <Button disabled={!isApproved} onClick={() => setSubmitted(true)}>
            Submit for review
          </Button>
          <span className="text-[12px] text-ink-dim">
            Submissions are stored off-chain; on-chain registration requires{' '}
            <span className="text-amber">protocol approval</span>.
          </span>
        </div>
        {submitted && isApproved && (
          <p className="mt-3 rounded-[10px] border border-emerald/30 bg-emerald/10 px-3 py-2 text-[12.5px] text-emerald">
            Submitted. A custodian will grade and vault the stone before it can be minted.
          </p>
        )}
      </Card>

      {/* Registered gems */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-ink">Your registered gems</h3>
          {!onChainApproved && <StatusBadge tone="warning">Requires protocol approval</StatusBadge>}
        </div>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {gems.slice(0, 3).map((g) => (
            <GemCard key={g.id} gem={g} ctaLabel="Manage →" />
          ))}
        </div>
      </div>
    </div>
  );
}

function StepBadge({ n, label, done, pending }: { n: string; label: string; done: boolean; pending?: boolean }) {
  const color = done ? '#35B98A' : pending ? '#E5A23C' : '#8B8B94';
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-white/[0.08] bg-panel p-3.5">
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold"
        style={{ background: `${color}1f`, color }}
      >
        {done ? '✓' : n}
      </span>
      <span className="text-[13px] text-ink-soft">{label}</span>
    </div>
  );
}

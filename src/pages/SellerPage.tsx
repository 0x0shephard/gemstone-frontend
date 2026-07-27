import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { GemCard } from '@/components/gem/GemCard';
import { useGems } from '@/hooks/useData';
import { useAuth } from '@/providers/AuthProvider';
import { env } from '@/config/env';
import { getContractAddress } from '@/config/contracts';
import { gemRegistryAbi } from '@/contracts/abis';
import {
  activateSellerGem,
  getSellerSubmissions,
  submitSellerGem,
  type SellerAttributes,
  type SellerSubmissionSummary,
} from '@/services/offchain/workflows';

const EMPTY_ATTRIBUTES: SellerAttributes = {
  name: '',
  gemstoneType: '',
  origin: '',
  caratWeight: 0,
  dimensions: '',
  color: '',
  clarity: '',
  cut: '',
  treatment: '',
  gradingLab: '',
  certificateNumber: '',
};

export default function SellerPage() {
  const { address } = useAccount();
  const { linkedWallet, user } = useAuth();
  const { data: gems = [] } = useGems();
  const [attributes, setAttributes] = useState(EMPTY_ATTRIBUTES);
  const [saleMode, setSaleMode] = useState<'' | 'buy_now' | 'auction'>('');
  const [custodyPreference, setCustodyPreference] = useState<
    'protocol_custodian' | 'approved_existing_custodian'
  >('protocol_custodian');
  const [notes, setNotes] = useState('');
  const [certificates, setCertificates] = useState<File[]>([]);
  const [media, setMedia] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string }>();
  const [submissions, setSubmissions] = useState<SellerSubmissionSummary[]>([]);
  const [activationId, setActivationId] = useState<string>();
  const walletVerified = Boolean(address && linkedWallet?.toLowerCase() === address.toLowerCase());
  const registryAddress = getContractAddress('GemRegistry');
  const sellerApproval = useReadContract({
    address: registryAddress,
    abi: gemRegistryAbi,
    functionName: 'sellerApproved',
    args: address ? [address] : undefined,
    query: { enabled: env.dataMode === 'chain' && Boolean(registryAddress && address) },
  });
  const onChainApproved = sellerApproval.data === true;

  const reloadSubmissions = useCallback(async () => {
    if (!user) {
      setSubmissions([]);
      return;
    }
    try {
      setSubmissions(await getSellerSubmissions());
    } catch {
      setSubmissions([]);
    }
  }, [user]);

  useEffect(() => {
    void reloadSubmissions();
  }, [reloadSubmissions]);

  const update = <K extends keyof SellerAttributes>(key: K, value: SellerAttributes[K]) =>
    setAttributes((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!address) return;
    if (!saleMode) {
      setResult({ ok: false, message: 'Choose buy now or auction before continuing.' });
      return;
    }
    setSubmitting(true);
    setResult(undefined);
    try {
      const submissionId = await submitSellerGem({
        sellerWallet: address,
        attributes,
        saleMode,
        custodyPreference,
        notes,
        certificates,
        media,
      });
      setResult({
        ok: true,
        message: `Submission ${submissionId} passed MVP auto-verification and entered automatic Sepolia activation.`,
      });
      setAttributes(EMPTY_ATTRIBUTES);
      setSaleMode('');
      setNotes('');
      setCertificates([]);
      setMedia([]);
      await reloadSubmissions();
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : 'Submission failed',
      });
    } finally {
      setSubmitting(false);
    }
  }

  const intakeEnabled = Boolean(user && walletVerified);

  async function retryActivation(submissionId: string) {
    setActivationId(submissionId);
    setResult(undefined);
    try {
      await activateSellerGem(submissionId);
      setResult({
        ok: true,
        message: 'Sepolia activation completed.',
      });
      await reloadSubmissions();
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : 'Activation retry failed',
      });
    } finally {
      setActivationId(undefined);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="dc-facet-border overflow-hidden p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.15em] text-emerald">
              Private intake
            </p>
            <h2 className="mt-2 text-[24px] font-semibold tracking-tight text-ink">
              Bring a gemstone on-chain
            </h2>
            <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
              Evidence stays private. During the Sepolia MVP, complete submissions are automatically
              verified, valued with the test-only flat-carat rule, committed and activated on-chain
              without publishing certificates or vault references.
            </p>
          </div>
          <StatusBadge tone="info">MVP auto-verification</StatusBadge>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <StepBadge n="1" label="MVP auto-verification" done />
          <StepBadge n="2" label="SIWE wallet verified" done={walletVerified} />
          <StepBadge n="3" label="Automatic protocol activation" done={onChainApproved} pending />
        </div>

        {!walletVerified && (
          <p className="mt-5 text-[12px] text-ink-muted">
            Sign in, then connect and verify your primary wallet from the account menu before
            submitting evidence.
          </p>
        )}
      </Card>

      <Card className="p-6 sm:p-7">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-semibold text-ink">Gemstone evidence package</h3>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              The Sepolia MVP uses $500 per carat, rounded up and capped at $100–$25,000. It is
              recorded as mvp-flat-carat-v1 and will be replaced by the custom pricing engine.
            </p>
          </div>
          {!intakeEnabled && <StatusBadge tone="warning">Sign-in + SIWE required</StatusBadge>}
        </div>

        <form onSubmit={submit}>
          <fieldset
            disabled={!intakeEnabled || submitting}
            className="grid gap-3 sm:grid-cols-2"
            style={{ opacity: intakeEnabled ? 1 : 0.5 }}
          >
            <Field
              label="Display name"
              required
              value={attributes.name}
              onChange={(event) => update('name', event.target.value)}
            />
            <Field
              label="Gemstone type"
              required
              placeholder="Ruby, sapphire, emerald…"
              value={attributes.gemstoneType}
              onChange={(event) => update('gemstoneType', event.target.value)}
            />
            <Field
              label="Origin"
              required
              value={attributes.origin}
              onChange={(event) => update('origin', event.target.value)}
            />
            <Field
              label="Carat weight"
              required
              type="number"
              min="0.01"
              step="0.01"
              value={attributes.caratWeight || ''}
              onChange={(event) => update('caratWeight', Number(event.target.value))}
            />
            <Field
              label="Dimensions (mm)"
              required
              placeholder="8.2 × 6.1 × 4.0"
              value={attributes.dimensions}
              onChange={(event) => update('dimensions', event.target.value)}
            />
            <Field
              label="Color description"
              required
              value={attributes.color}
              onChange={(event) => update('color', event.target.value)}
            />
            <Field
              label="Clarity"
              required
              value={attributes.clarity}
              onChange={(event) => update('clarity', event.target.value)}
            />
            <Field
              label="Cut / shape"
              required
              value={attributes.cut}
              onChange={(event) => update('cut', event.target.value)}
            />
            <Field
              label="Treatment"
              required
              placeholder="None, heat, oil…"
              value={attributes.treatment}
              onChange={(event) => update('treatment', event.target.value)}
            />
            <Field
              label="Grading laboratory"
              required
              value={attributes.gradingLab}
              onChange={(event) => update('gradingLab', event.target.value)}
            />
            <Field
              label="Certificate number"
              required
              value={attributes.certificateNumber}
              onChange={(event) => update('certificateNumber', event.target.value)}
            />
            <label>
              <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
                Custody preference
              </span>
              <select
                className={inputClass}
                value={custodyPreference}
                onChange={(event) =>
                  setCustodyPreference(event.target.value as typeof custodyPreference)
                }
              >
                <option value="protocol_custodian">Assign an approved protocol custodian</option>
                <option value="approved_existing_custodian">
                  Use my approved existing custodian
                </option>
              </select>
            </label>
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-[12px] font-medium text-ink-muted">
                Preferred first sale
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  {
                    value: 'buy_now' as const,
                    eyebrow: 'Immediate',
                    title: 'Buy now',
                    body: 'List at the temporary MVP valuation after automated custody activation.',
                  },
                  {
                    value: 'auction' as const,
                    eyebrow: '24 hours',
                    title: 'Auction',
                    body: 'Open bidding at no less than the temporary MVP valuation.',
                  },
                ].map((option) => {
                  const selected = saleMode === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`relative cursor-pointer rounded-[4px] border p-4 transition-colors focus-within:ring-2 focus-within:ring-atelier/60 ${
                        selected
                          ? 'border-atelier/45 bg-atelier/[0.08]'
                          : 'border-line/[0.09] bg-inset hover:border-line/[0.16]'
                      }`}
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name="sale-mode"
                        value={option.value}
                        checked={selected}
                        onChange={() => setSaleMode(option.value)}
                      />
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-atelier">
                        {option.eyebrow}
                      </span>
                      <span className="mt-1 block text-[14px] font-semibold text-ink">
                        {option.title}
                      </span>
                      <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-muted">
                        {option.body}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
                          selected
                            ? 'border-atelier bg-atelier text-[var(--dc-button-ink)]'
                            : 'border-line/[0.14] text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label>
              <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
                Certificates · PDF/JPEG/PNG · 20 MB each
              </span>
              <input
                className={inputClass}
                type="file"
                required
                multiple
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(event) => setCertificates(Array.from(event.target.files ?? []))}
              />
            </label>
            <label>
              <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
                Gem media · JPEG/PNG/WebP · max 10
              </span>
              <input
                className={inputClass}
                type="file"
                required
                multiple
                accept=".jpg,.jpeg,.png,.webp"
                onChange={(event) => setMedia(Array.from(event.target.files ?? []).slice(0, 10))}
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
                Private reviewer notes
              </span>
              <textarea
                className={`${inputClass} h-24 resize-y py-2.5`}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
          </fieldset>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!intakeEnabled || submitting || !saleMode}>
              {submitting ? 'Verifying & uploading…' : 'Submit and auto-verify'}
            </Button>
            <span className="text-[12px] text-ink-dim">
              Exact files remain in private Supabase Storage with row-level access controls.
            </span>
          </div>
        </form>

        {result && (
          <p
            className={`mt-3 rounded-[4px] border px-3 py-2 text-[12.5px] ${result.ok ? 'border-emerald/30 bg-emerald/10 text-emerald' : 'border-ruby/30 bg-ruby/10 text-ruby'}`}
          >
            {result.message}
          </p>
        )}

        {submissions.length > 0 && (
          <div className="mt-7 border-t border-line/[0.08] pt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[14px] font-semibold text-ink">Activation queue</h3>
                <p className="mt-0.5 text-[11.5px] text-ink-muted">
                  Approved evidence is committed, valued and listed automatically on Sepolia.
                </p>
              </div>
              <span className="font-mono text-[10.5px] text-ink-dim">
                {submissions.length} submission{submissions.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="space-y-2">
              {submissions.map((submission) => {
                const approved = submission.status === 'approved';
                const activated = Boolean(submission.onchainGemId);
                return (
                  <div
                    key={submission.id}
                    className="flex flex-wrap items-center gap-3 rounded-[4px] border border-line/[0.08] bg-inset px-3.5 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[11px] text-ink-soft">
                        {submission.id}
                      </p>
                      <p className="mt-1 text-[11.5px] text-ink-muted">
                        {submission.saleMode === 'auction' ? '24-hour auction' : 'Buy now'} ·{' '}
                        {new Date(submission.createdAt).toLocaleDateString()}
                        {submission.verificationProvider === 'mvp-auto'
                          ? ' · MVP auto-verified'
                          : ''}
                        {submission.approvedValuationUsd
                          ? ` · $${Number(BigInt(submission.approvedValuationUsd) / 10n ** 18n).toLocaleString()}`
                          : ''}
                      </p>
                    </div>
                    <StatusBadge
                      tone={
                        activated
                          ? 'success'
                          : approved
                            ? 'info'
                            : submission.status === 'rejected'
                              ? 'danger'
                              : 'warning'
                      }
                    >
                      {activated
                        ? `Gem #${submission.onchainGemId}`
                        : submission.status.replace('_', ' ')}
                    </StatusBadge>
                    {!activated &&
                      (submission.activationState === 'failed' ||
                        (approved && submission.certificateHash)) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={activationId === submission.id}
                          onClick={() => void retryActivation(submission.id)}
                        >
                          {activationId === submission.id ? 'Activating…' : 'Retry activation'}
                        </Button>
                      )}
                    {submission.certificateHash && !activated && (
                      <StatusBadge
                        tone={submission.activationState === 'failed' ? 'danger' : 'info'}
                      >
                        {submission.activationState === 'failed'
                          ? 'Activation failed'
                          : submission.activationState?.replace('_', ' ') || 'Activating'}
                      </StatusBadge>
                    )}
                    {submission.activationError && !activated && (
                      <p className="basis-full text-[11px] text-ruby">
                        {submission.activationError}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-ink">Registered gems</h3>
          {!onChainApproved && (
            <StatusBadge tone="warning">Activation starts on submission</StatusBadge>
          )}
        </div>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {gems.slice(0, 3).map((gem) => (
            <GemCard
              key={gem.gemId.toString()}
              gem={gem}
              ctaLabel="Manage →"
              href={`/gem/${gem.gemId}?manage=1`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StepBadge({
  n,
  label,
  done,
  pending,
}: {
  n: string;
  label: string;
  done: boolean;
  pending?: boolean;
}) {
  const color = done ? 'var(--dc-emerald)' : pending ? 'var(--dc-amber)' : '#929BA8';
  return (
    <div className="flex items-center gap-3 rounded-[4px] border border-line/[0.08] bg-panel p-3.5">
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold"
        style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
      >
        {done ? '✓' : n}
      </span>
      <span className="text-[13px] text-ink-soft">{label}</span>
    </div>
  );
}

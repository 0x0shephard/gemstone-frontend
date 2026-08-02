import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Labeled, inputClass } from '@/components/ui/Field';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/States';
import { useAuth } from '@/providers/AuthProvider';
import {
  loadQueue,
  loadSubmission,
  previewPrice,
  rejectSubmission,
  setVerificationMode,
  submitGrading,
  ppmToNumber,
  usdFromBaseUnits,
  type Breakdown,
  type EvidenceFile,
  type GradeInput,
  type MatrixOptions,
  type QueueItem,
  type VerificationMode,
} from '@/services/offchain/verification';

/**
 * Grading portal for third-party labs.
 *
 * Not linked from public navigation, and non-members get the same "not found"
 * response the API returns rather than a login prompt — an unauthorised visitor
 * learns nothing about whether the route exists.
 *
 * Every dropdown below is populated from the pricing matrix the server serves,
 * never from a local list. A hardcoded option that the matrix has since dropped
 * would let a grader assess a whole stone before the engine refused it.
 */

const EMPTY: GradeInput = {
  variety: '',
  caratWeight: 0,
  clarity: '',
  treatment: '',
  shape: '',
  color: '',
  colorGrade: '',
};

const money = (value: number) => `$${value.toLocaleString('en-US')}`;
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export default function VerifyPage() {
  const { user, loading: authLoading } = useAuth();
  /*
   * Deliberately distinct from `refreshing`. Only the first load has nothing to
   * show and may replace the page with a skeleton; a later refetch must leave the
   * rendered page in place, or every queue update blanks the whole portal.
   */
  const [initialising, setInitialising] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [organization, setOrganization] = useState<string>();
  const [matrix, setMatrix] = useState<MatrixOptions>();
  const [mode, setMode] = useState<VerificationMode>('lab');
  const [modePending, setModePending] = useState<VerificationMode>();
  const [canManage, setCanManage] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selected, setSelected] = useState<QueueItem>();
  const [evidence, setEvidence] = useState<EvidenceFile[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [primaryImageId, setPrimaryImageId] = useState<string>();
  const [grades, setGrades] = useState<GradeInput>(EMPTY);
  const [preview, setPreview] = useState<{ usd: number; breakdown: Breakdown; version: string }>();
  const [priceError, setPriceError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [result, setResult] = useState<{ tone: 'ok' | 'warn' | 'error'; message: string }>();

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await loadQueue();
      if (!data) {
        setOrganization(undefined);
        return;
      }
      setOrganization(data.organization);
      setMatrix(data.matrix);
      setMode(data.verificationMode);
      setCanManage(data.canManageSettings);
      setQueue(data.queue);
    } finally {
      setRefreshing(false);
      setInitialising(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) void refresh();
    else if (!authLoading) setInitialising(false);
  }, [authLoading, user, refresh]);

  const variety = matrix?.varieties.find((entry) => entry.name === grades.variety);
  const images = useMemo(() => evidence.filter((file) => file.eligibleAsPrimaryImage), [evidence]);

  const complete = useMemo(
    () =>
      Boolean(
        grades.variety &&
        grades.clarity &&
        grades.treatment &&
        grades.shape &&
        grades.color &&
        grades.colorGrade &&
        grades.caratWeight > 0,
      ),
    [grades],
  );

  // Priced server-side by the same code path that will commit the figure, so the
  // number a grader approves cannot drift from the number recorded.
  useEffect(() => {
    if (!selected || !complete) {
      setPreview(undefined);
      setPriceError(undefined);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const priced = await previewPrice(selected.id, grades);
        if (cancelled) return;
        setPriceError(undefined);
        setPreview({
          usd: usdFromBaseUnits(priced.approvedValuationUsd),
          breakdown: priced.breakdown,
          version: priced.matrixVersion,
        });
      } catch (error) {
        if (cancelled) return;
        setPreview(undefined);
        setPriceError(error instanceof Error ? error.message : 'Pricing failed');
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selected, grades, complete]);

  async function open(item: QueueItem) {
    setSelected(item);
    setGrades({ ...EMPTY, caratWeight: item.carats ?? 0 });
    setPreview(undefined);
    setResult(undefined);
    setEvidence([]);
    setPrimaryImageId(undefined);
    setRejectReason('');
    // Without this the empty-evidence branch renders while the fetch is in
    // flight, telling the grader the stone has no photograph and will be
    // registered without one — alarming, and untrue.
    setEvidenceLoading(true);
    try {
      const detail = await loadSubmission(item.id);
      setEvidence(detail.evidence);
      // Default to the seller's first photograph; the grader can promote another.
      setPrimaryImageId(detail.evidence.find((file) => file.eligibleAsPrimaryImage)?.id);
    } catch (error) {
      setResult({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Evidence could not be loaded',
      });
    } finally {
      setEvidenceLoading(false);
    }
  }

  function close() {
    setSelected(undefined);
    setEvidence([]);
    setPrimaryImageId(undefined);
  }

  async function commit(event: FormEvent) {
    event.preventDefault();
    if (!selected || !complete) return;
    setSubmitting(true);
    setResult(undefined);
    try {
      const response = await submitGrading(selected.id, grades, primaryImageId);
      const usd = money(usdFromBaseUnits(response.approvedValuationUsd));
      if (response.activationState === 'failed') {
        // The valuation is durable and activation is resumable, so this is a
        // retry prompt rather than a lost grading.
        setResult({
          tone: 'warn',
          message: `Valuation recorded at ${usd}, but the on-chain activation did not complete: ${
            response.activationError ?? 'unknown error'
          }. An operator can resume it; the grading is saved and will not be redone.`,
        });
      } else {
        setResult({
          tone: 'ok',
          message: `Recorded at ${usd}. Gem ${response.activation?.onchainGemId ?? 'pending'}.`,
        });
      }
      close();
      await refresh();
    } catch (error) {
      setResult({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Grading failed',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function refuse() {
    if (!selected) return;
    setRejecting(true);
    setResult(undefined);
    try {
      await rejectSubmission(selected.id, rejectReason.trim());
      setResult({ tone: 'ok', message: 'Submission rejected. Nothing was written on-chain.' });
      close();
      await refresh();
    } catch (error) {
      setResult({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Rejection failed',
      });
    } finally {
      setRejecting(false);
    }
  }

  /*
   * One round trip, not two. The mode governs how *future* submissions are
   * routed, so nothing already in the queue changes and the reload that used to
   * follow was pure latency — and it blanked the page while it ran.
   */
  async function changeMode(next: VerificationMode) {
    if (next === mode || modePending) return;
    setResult(undefined);
    setModePending(next);
    try {
      const { verificationMode } = await setVerificationMode(next);
      setMode(verificationMode);
    } catch (error) {
      setResult({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Could not change verification mode',
      });
    } finally {
      setModePending(undefined);
    }
  }

  if (authLoading || initialising) {
    return (
      <div className="mx-auto w-full max-w-content p-8">
        <Skeleton className="h-64" />
      </div>
    );
  }

  // Same response an unauthorised caller gets from the API: the route does not
  // advertise its own existence.
  if (!user || !organization || !matrix) {
    return (
      <div className="mx-auto w-full max-w-content px-6 py-24 text-center">
        <h1 className="font-display text-[28px] font-medium text-ink">Page not found</h1>
        <p className="mt-3 text-[14px] text-ink-muted">
          This address does not correspond to anything you can access.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-content space-y-6 px-5 py-8 sm:px-6 md:px-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-atelier">
            Verification portal
          </p>
          <h1 className="mt-2 font-display text-[27px] font-medium tracking-[-0.03em] text-ink">
            Gemological review
          </h1>
          <p className="mt-2 text-[13.5px] text-ink-muted">
            Signed in as {organization}. Grades recorded here set the permanent on-chain valuation.
          </p>
        </div>
        <StatusBadge tone="neutral" dot>
          {refreshing ? 'Refreshing…' : `${queue.length} awaiting review`}
        </StatusBadge>
      </header>

      {canManage && <ModeControl mode={mode} pending={modePending} onChange={changeMode} />}

      {mode === 'auto' && (
        <p className="rounded-[4px] border border-amber/25 bg-amber/[0.06] px-4 py-3 text-[13px] text-amber">
          Automatic verification is active. New submissions are priced by the test-only
          $500-per-carat rule and listed without reaching this queue.
        </p>
      )}

      {result && (
        <div
          role="status"
          className={`rounded-[4px] border px-4 py-3 text-[13px] ${
            result.tone === 'ok'
              ? 'border-emerald/25 bg-emerald/[0.06] text-emerald'
              : result.tone === 'warn'
                ? 'border-amber/25 bg-amber/[0.06] text-amber'
                : 'border-ruby/25 bg-ruby/[0.06] text-ruby'
          }`}
        >
          {result.message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="p-0">
          <div className="border-b border-line/[0.08] px-4 py-3 text-[12px] font-semibold text-ink-soft">
            Queue
          </div>
          {queue.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-ink-muted">Nothing awaiting review.</p>
          ) : (
            <ul>
              {queue.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void open(item)}
                    className={`w-full border-b border-line/[0.06] px-4 py-3 text-left transition-colors hover:bg-line/[0.03] ${
                      selected?.id === item.id ? 'bg-line/[0.05]' : ''
                    }`}
                  >
                    <div className="text-[13.5px] font-medium text-ink">{item.gem_name}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-ink-dim">
                      {item.carats ?? '—'} ct · {new Date(item.created_at).toLocaleDateString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {selected ? (
          <div className="space-y-5">
            <Card className="space-y-4 p-5">
              <div>
                <h2 className="font-display text-[17px] font-medium text-ink">
                  {selected.gem_name}
                </h2>
                <p className="mt-1 text-[12px] text-ink-dim">
                  Seller claims below are unverified. Your grades are what price the stone.
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-x-5 gap-y-2 rounded-[4px] bg-line/[0.03] p-3 text-[12.5px] sm:grid-cols-3">
                {Object.entries(selected.attributes ?? {})
                  .filter(([, value]) => value !== '' && value !== null)
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-[10.5px] uppercase tracking-[0.1em] text-ink-dim">
                        {key}
                      </dt>
                      <dd className="text-ink-soft">{String(value)}</dd>
                    </div>
                  ))}
              </dl>

              <ImageSelector
                images={images}
                loading={evidenceLoading}
                selectedId={primaryImageId}
                onSelect={setPrimaryImageId}
              />

              <div>
                <h3 className="mb-2 text-[12px] font-semibold text-ink-soft">Certificates</h3>
                {evidenceLoading ? (
                  <p className="text-[12.5px] text-ink-muted">Loading evidence…</p>
                ) : evidence.length === 0 ? (
                  <p className="text-[12.5px] text-ink-muted">No evidence files on record.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {evidence
                      .filter((file) => !file.eligibleAsPrimaryImage)
                      .map((file) => (
                        <li key={file.id} className="flex items-center justify-between gap-3">
                          <span className="font-mono text-[11.5px] text-ink-muted">
                            {file.category} · {file.sha256.slice(0, 12)}…
                          </span>
                          {file.url ? (
                            <a
                              href={file.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[12px] font-medium text-atelier"
                            >
                              Open ↗
                            </a>
                          ) : (
                            <span className="text-[12px] text-ink-dim">Unavailable</span>
                          )}
                        </li>
                      ))}
                  </ul>
                )}
                <p className="mt-2 text-[11px] text-ink-dim">
                  Certificates stay private and are never published to IPFS.
                </p>
              </div>
            </Card>

            <form onSubmit={commit}>
              <Card className="space-y-4 p-5">
                <h3 className="text-[13px] font-semibold text-ink">Authoritative grading</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Labeled label="Variety">
                    <select
                      className={inputClass}
                      value={grades.variety}
                      onChange={(event) =>
                        setGrades({
                          ...grades,
                          variety: event.target.value,
                          color: '',
                          colorGrade: '',
                        })
                      }
                    >
                      <option value="">Select…</option>
                      {matrix.varieties.map((entry) => (
                        <option key={entry.name} value={entry.name}>
                          {titleCase(entry.name)}
                        </option>
                      ))}
                    </select>
                  </Labeled>
                  <Labeled
                    label="Carat weight"
                    hint={`Priced from ${matrix.caratRange.min} to ${matrix.caratRange.max} ct`}
                  >
                    <input
                      type="number"
                      step="0.01"
                      min={matrix.caratRange.min}
                      max={matrix.caratRange.max}
                      className={inputClass}
                      value={grades.caratWeight || ''}
                      onChange={(event) =>
                        setGrades({ ...grades, caratWeight: Number(event.target.value) })
                      }
                    />
                  </Labeled>
                  <Choice
                    label="Clarity"
                    options={matrix.clarities}
                    value={grades.clarity}
                    onChange={(clarity) => setGrades({ ...grades, clarity })}
                  />
                  <Choice
                    label="Treatment"
                    options={matrix.treatments}
                    value={grades.treatment}
                    onChange={(treatment) => setGrades({ ...grades, treatment })}
                  />
                  <Choice
                    label="Shape"
                    options={matrix.shapes}
                    value={grades.shape}
                    onChange={(shape) => setGrades({ ...grades, shape })}
                  />
                  <Choice
                    label="Colour"
                    options={variety?.colors ?? []}
                    value={grades.color}
                    disabled={!variety}
                    onChange={(color) => setGrades({ ...grades, color })}
                  />
                  <Choice
                    label="Colour grade"
                    options={variety?.colorGrades ?? []}
                    value={grades.colorGrade}
                    disabled={!variety}
                    onChange={(colorGrade) => setGrades({ ...grades, colorGrade })}
                  />
                </div>

                {priceError && (
                  <p
                    role="alert"
                    className="rounded-[4px] border border-ruby/25 bg-ruby/[0.06] px-3 py-2.5 text-[12.5px] text-ruby"
                  >
                    {priceError}
                  </p>
                )}

                {preview && (
                  <PriceBreakdown
                    usd={preview.usd}
                    breakdown={preview.breakdown}
                    version={preview.version}
                  />
                )}

                <div className="flex flex-wrap items-center gap-3 border-t border-line/[0.08] pt-4">
                  <Button type="submit" disabled={!complete || !preview || submitting}>
                    {submitting ? 'Recording…' : 'Approve and record on-chain'}
                  </Button>
                  <p className="text-[11.5px] text-ink-dim">
                    This registers the gem, writes a permanent valuation, and cannot be undone.
                  </p>
                </div>
              </Card>
            </form>

            <Card className="space-y-3 p-5">
              <h3 className="text-[13px] font-semibold text-ink">Reject</h3>
              <p className="text-[12.5px] text-ink-muted">
                Refuses the stone. Nothing is registered on-chain and no image is published, so a
                rejected submission leaves no permanent trace.
              </p>
              <Labeled label="Reason" hint="Shared with the seller. At least 10 characters.">
                <textarea
                  className={`${inputClass} min-h-[80px]`}
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                />
              </Labeled>
              <Button
                type="button"
                variant="ghost"
                disabled={rejectReason.trim().length < 10 || rejecting}
                onClick={() => void refuse()}
              >
                {rejecting ? 'Rejecting…' : 'Reject submission'}
              </Button>
            </Card>
          </div>
        ) : (
          <Card className="flex items-center justify-center p-12">
            <p className="text-[13.5px] text-ink-muted">Select a submission to begin grading.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

/** Matrix-backed dropdown. Options are lowercase keys; labels are presentational. */
function Choice({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Labeled label={label}>
      <select
        className={inputClass}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select…</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {titleCase(option)}
          </option>
        ))}
      </select>
    </Labeled>
  );
}

/**
 * Promotes one seller photograph to the public NFT image.
 *
 * The choice is permanent: the image is pinned to IPFS, its CID sealed into the
 * metadata document, and that document's URI written by `registerGem` to a field
 * with no setter. Reviewing the photograph here is the only opportunity to
 * reject a bad one.
 */
function ImageSelector({
  images,
  loading,
  selectedId,
  onSelect,
}: {
  images: EvidenceFile[];
  loading: boolean;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div>
        <h3 className="mb-2 text-[12px] font-semibold text-ink-soft">Public image</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((slot) => (
            <Skeleton key={slot} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div>
        <h3 className="mb-2 text-[12px] font-semibold text-ink-soft">Public image</h3>
        <p className="text-[12.5px] text-ink-muted">
          No gemstone media on this submission. The gem will be registered without a public image,
          and that cannot be added later.
        </p>
      </div>
    );
  }

  return (
    <fieldset>
      <legend className="mb-2 text-[12px] font-semibold text-ink-soft">
        Public image · permanent
      </legend>
      <p className="mb-2.5 text-[11.5px] text-ink-dim">
        The selected photograph is published to IPFS and written into the token metadata. It cannot
        be changed after approval.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {images.map((file) => {
          const active = file.id === selectedId;
          return (
            <label
              key={file.id}
              className={`relative block cursor-pointer overflow-hidden rounded-[4px] border transition-colors ${
                active ? 'border-atelier' : 'border-line/[0.1] hover:border-line/25'
              }`}
            >
              <input
                type="radio"
                name="primary-image"
                className="sr-only"
                checked={active}
                onChange={() => onSelect(file.id)}
              />
              {file.url ? (
                <img
                  src={file.url}
                  alt={`Gemstone media ${file.sha256.slice(0, 8)}`}
                  className="h-28 w-full object-cover"
                />
              ) : (
                <span className="flex h-28 items-center justify-center text-[11px] text-ink-dim">
                  Unavailable
                </span>
              )}
              {active && (
                <span className="absolute left-1.5 top-1.5 rounded-[3px] bg-atelier px-1.5 py-0.5 text-[10px] font-semibold text-black">
                  Primary
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Protocol-wide switch, visible only to an admin organisation's owner. */
function ModeControl({
  mode,
  pending,
  onChange,
}: {
  mode: VerificationMode;
  pending?: VerificationMode;
  onChange: (mode: VerificationMode) => void | Promise<void>;
}) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
      <div>
        <h2 className="text-[13px] font-semibold text-ink">Verification mode</h2>
        <p className="mt-1 max-w-prose text-[12.5px] text-ink-muted">
          {mode === 'lab'
            ? 'New submissions wait here for a graded valuation. Nothing reaches the chain until a lab approves.'
            : 'New submissions bypass this queue and are priced by the test-only $500-per-carat rule.'}
        </p>
      </div>
      <div className="flex gap-2">
        {(['lab', 'auto'] as const).map((option) => (
          <Button
            key={option}
            type="button"
            variant={mode === option ? 'primary' : 'ghost'}
            // Both disable while a switch is in flight: the setting is global, and
            // a second click mid-request would race the first.
            disabled={Boolean(pending)}
            aria-pressed={mode === option}
            onClick={() => void onChange(option)}
          >
            {pending === option ? 'Switching…' : option === 'lab' ? 'Lab review' : 'Automatic'}
          </Button>
        ))}
      </div>
    </Card>
  );
}

/** Full derivation, so the grader approves a figure they can see computed. */
function PriceBreakdown({
  usd,
  breakdown,
  version,
}: {
  usd: number;
  breakdown: Breakdown;
  version: string;
}) {
  const rows: Array<[string, string]> = [
    ['Base per carat', money(Number(breakdown.basePricePerCaratUsd))],
    ['Carat', `× ${ppmToNumber(breakdown.caratMultiplierPpm).toFixed(3)}`],
    ['Clarity', `× ${ppmToNumber(breakdown.clarityMultiplierPpm).toFixed(2)}`],
    ['Treatment', `× ${ppmToNumber(breakdown.treatmentMultiplierPpm).toFixed(2)}`],
  ];

  return (
    <div className="rounded-[4px] border border-line/[0.08] bg-line/[0.02] p-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[12px] font-semibold text-ink-soft">Computed valuation</span>
        <span className="font-mono text-[22px] font-medium text-ink">{money(usd)}</span>
      </div>

      <dl className="mt-3 space-y-1 text-[12px]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="font-mono text-ink-soft">{value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-line/[0.07] pt-1">
          <dt className="text-ink-muted">Base value</dt>
          <dd className="font-mono text-ink-soft">
            {money(usdFromBaseUnits(breakdown.baseValueUsd))}
          </dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-line/[0.07] pt-3">
        <p className="mb-1.5 text-[11px] uppercase tracking-[0.1em] text-ink-dim">
          Market preference
        </p>
        <dl className="space-y-1 text-[12px]">
          {breakdown.marketMultipliers.map((detail) => (
            <div key={detail.criterion} className="flex justify-between gap-4">
              <dt className="text-ink-muted">
                {detail.criterion} · {detail.choice}
                <span className="ml-1.5 text-ink-dim">
                  ({detail.observed}/{detail.totalObserved} bids)
                </span>
              </dt>
              <dd className="font-mono text-ink-soft">
                × {ppmToNumber(detail.multiplierPpm).toFixed(3)}
                {detail.clamped && <span className="ml-1 text-amber">clamped</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="mt-3 font-mono text-[10.5px] text-ink-dim">{version}</p>
    </div>
  );
}

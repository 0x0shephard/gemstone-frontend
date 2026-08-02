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
  submitGrading,
  ppmToNumber,
  usdFromBaseUnits,
  type Breakdown,
  type EvidenceFile,
  type GradeInput,
  type QueueItem,
} from '@/services/offchain/verification';

/**
 * Grading portal for third-party labs.
 *
 * Not linked from public navigation, and non-members get the same "not found"
 * response the API returns rather than a login prompt — an unauthorised visitor
 * learns nothing about whether the route exists.
 */

const VARIETIES = ['Emerald', 'Sapphire', 'Ruby', 'Peridot'];
const CLARITIES = ['Dcl', 'I3', 'I2', 'I1', 'SI2', 'SI1', 'VS', 'VVS'];
const TREATMENTS = ['Heated', 'Minor heat', 'Unheated', 'Oiled', 'No oil'];
const SHAPES = [
  'Cabochon',
  'Cushion',
  'Emerald cut',
  'Marquise',
  'Oval',
  'Pear',
  'Round',
  'Diamond cut',
];
const COLORS_BY_VARIETY: Record<string, string[]> = {
  Emerald: ['Green'],
  Sapphire: [
    'Blue',
    'Purple',
    'Gray',
    'Green',
    'Brown',
    'Orange',
    'Pink',
    'Violet',
    'White',
    'Yellow',
  ],
  Ruby: ['Red'],
  Peridot: ['Green'],
};
const GRADES_BY_VARIETY: Record<string, string[]> = {
  Emerald: ['Bluish green', 'Deep green', 'Light green'],
  Sapphire: ['Dark', 'Medium', 'Light'],
  Ruby: ['Dark', 'Medium', 'Light'],
  Peridot: ['Dark', 'Medium', 'Light'],
};

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

export default function VerifyPage() {
  const { user, loading: authLoading } = useAuth();
  const [checking, setChecking] = useState(true);
  const [organization, setOrganization] = useState<string>();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selected, setSelected] = useState<QueueItem>();
  const [evidence, setEvidence] = useState<EvidenceFile[]>([]);
  const [grades, setGrades] = useState<GradeInput>(EMPTY);
  const [preview, setPreview] = useState<{ usd: number; breakdown: Breakdown; version: string }>();
  const [priceError, setPriceError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string }>();

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const data = await loadQueue();
      if (!data) {
        setOrganization(undefined);
        return;
      }
      setOrganization(data.organization);
      setQueue(data.queue);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) void refresh();
    else if (!authLoading) setChecking(false);
  }, [authLoading, user, refresh]);

  const colors = COLORS_BY_VARIETY[grades.variety] ?? [];
  const colorGrades = GRADES_BY_VARIETY[grades.variety] ?? [];

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
        const result = await previewPrice(selected.id, grades);
        if (cancelled) return;
        setPriceError(undefined);
        setPreview({
          usd: usdFromBaseUnits(result.approvedValuationUsd),
          breakdown: result.breakdown,
          version: result.matrixVersion,
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
    const detail = await loadSubmission(item.id);
    setEvidence(detail.evidence);
  }

  async function commit(event: FormEvent) {
    event.preventDefault();
    if (!selected || !complete) return;
    setSubmitting(true);
    setResult(undefined);
    try {
      const response = await submitGrading(selected.id, grades);
      setResult({
        ok: true,
        message: `Recorded at ${money(usdFromBaseUnits(response.approvedValuationUsd))}. Gem ${
          response.activation?.onchainGemId ?? 'pending'
        }.`,
      });
      setSelected(undefined);
      await refresh();
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : 'Grading failed',
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || checking) {
    return (
      <div className="mx-auto w-full max-w-content p-8">
        <Skeleton className="h-64" />
      </div>
    );
  }

  // Same response an unauthorised caller gets from the API: the route does not
  // advertise its own existence.
  if (!user || !organization) {
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
          {queue.length} awaiting review
        </StatusBadge>
      </header>

      {result && (
        <div
          role="status"
          className={`rounded-[4px] border px-4 py-3 text-[13px] ${
            result.ok
              ? 'border-emerald/25 bg-emerald/[0.06] text-emerald'
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

              <div>
                <h3 className="mb-2 text-[12px] font-semibold text-ink-soft">Evidence</h3>
                {evidence.length === 0 ? (
                  <p className="text-[12.5px] text-ink-muted">Loading evidence…</p>
                ) : (
                  <ul className="space-y-1.5">
                    {evidence.map((file) => (
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
                      {VARIETIES.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Labeled>
                  <Labeled label="Carat weight" hint="Priced from 0.5 to 5.0 ct">
                    <input
                      type="number"
                      step="0.01"
                      min="0.5"
                      max="5"
                      className={inputClass}
                      value={grades.caratWeight || ''}
                      onChange={(event) =>
                        setGrades({ ...grades, caratWeight: Number(event.target.value) })
                      }
                    />
                  </Labeled>
                  <Labeled label="Clarity">
                    <select
                      className={inputClass}
                      value={grades.clarity}
                      onChange={(event) => setGrades({ ...grades, clarity: event.target.value })}
                    >
                      <option value="">Select…</option>
                      {CLARITIES.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Labeled>
                  <Labeled label="Treatment">
                    <select
                      className={inputClass}
                      value={grades.treatment}
                      onChange={(event) => setGrades({ ...grades, treatment: event.target.value })}
                    >
                      <option value="">Select…</option>
                      {TREATMENTS.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Labeled>
                  <Labeled label="Shape">
                    <select
                      className={inputClass}
                      value={grades.shape}
                      onChange={(event) => setGrades({ ...grades, shape: event.target.value })}
                    >
                      <option value="">Select…</option>
                      {SHAPES.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Labeled>
                  <Labeled label="Colour">
                    <select
                      className={inputClass}
                      value={grades.color}
                      disabled={!grades.variety}
                      onChange={(event) => setGrades({ ...grades, color: event.target.value })}
                    >
                      <option value="">Select…</option>
                      {colors.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Labeled>
                  <Labeled label="Colour grade">
                    <select
                      className={inputClass}
                      value={grades.colorGrade}
                      disabled={!grades.variety}
                      onChange={(event) => setGrades({ ...grades, colorGrade: event.target.value })}
                    >
                      <option value="">Select…</option>
                      {colorGrades.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Labeled>
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

                <div className="flex items-center gap-3 border-t border-line/[0.08] pt-4">
                  <Button type="submit" disabled={!complete || !preview || submitting}>
                    {submitting ? 'Recording…' : 'Approve and record on-chain'}
                  </Button>
                  <p className="text-[11.5px] text-ink-dim">
                    This writes a permanent valuation and cannot be undone.
                  </p>
                </div>
              </Card>
            </form>
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

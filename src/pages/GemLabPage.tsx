import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OperationsAccessGate } from '@/components/operations/OperationsAccessGate';
import { LifecycleTracker } from '@/components/operations/LifecycleTracker';
import {
  eventPresentation,
  sellerLifecycleStages,
} from '@/components/operations/lifecyclePresentation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { Field, Labeled, inputClass } from '@/components/ui/Field';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { useOperationsAccess } from '@/hooks/useOperationsAccess';
import { gradeLabel, gradeOptions, type GradeOptions } from '@/lib/gradeOptions';
import {
  clearOperationIdempotencyKey,
  createMatrixDraft,
  loadAppraisalMatrices,
  loadGemLabDetail,
  loadGemLabQueue,
  operationIdempotencyKey,
  previewGemAppraisal,
  proposeMatrix,
  submitGemAppraisal,
  type GemGradeInput,
  type GemLabQueueItem,
} from '@/services/offchain/operations';

type LabTab = 'queue' | 'matrix';

const EMPTY_GRADE: GemGradeInput = {
  variety: '',
  caratWeight: 0,
  clarity: '',
  treatment: '',
  shape: '',
  color: '',
  colorGrade: '',
};

export default function GemLabPage() {
  return (
    <OperationsAccessGate capability="gemlab.read">
      <GemLabWorkspace />
    </OperationsAccessGate>
  );
}

function GemLabWorkspace() {
  const queryClient = useQueryClient();
  const { data: access, has } = useOperationsAccess();
  const [tab, setTab] = useState<LabTab>('queue');
  const [selected, setSelected] = useState<GemLabQueueItem>();
  const [grades, setGrades] = useState<GemGradeInput>(EMPTY_GRADE);
  const [primaryImageId, setPrimaryImageId] = useState<string>();
  const [matrixVersion, setMatrixVersion] = useState('');
  const [matrixDocument, setMatrixDocument] = useState('');
  const [message, setMessage] = useState<string>();

  const queueQuery = useQuery({
    queryKey: ['operations', 'gemlab', 'queue'],
    queryFn: loadGemLabQueue,
    placeholderData: (previous) => previous,
  });
  const detailQuery = useQuery({
    queryKey: ['operations', 'gemlab', 'detail', selected?.submissionId],
    queryFn: () => loadGemLabDetail(selected!.submissionId),
    enabled: Boolean(selected),
  });
  const matrixQuery = useQuery({
    queryKey: ['operations', 'matrices'],
    queryFn: loadAppraisalMatrices,
    enabled: tab === 'matrix',
  });

  useEffect(() => {
    if (!selected) return;
    setGrades({ ...EMPTY_GRADE, caratWeight: selected.carats ?? 0 });
    setPrimaryImageId(undefined);
    setMessage(undefined);
  }, [selected]);

  useEffect(() => {
    const evidence = detailQuery.data?.evidence;
    if (!evidence || primaryImageId) return;
    setPrimaryImageId(evidence.find((item) => item.eligibleAsPrimaryImage)?.id);
  }, [detailQuery.data?.evidence, primaryImageId]);

  const gradeComplete = Object.entries(grades).every(([, value]) =>
    typeof value === 'number' ? value > 0 : value.trim().length > 0,
  );
  const previewQuery = useQuery({
    queryKey: ['operations', 'gemlab', 'preview', selected?.submissionId, grades, primaryImageId],
    queryFn: () => previewGemAppraisal(selected!.submissionId, grades, primaryImageId!),
    enabled: Boolean(selected && gradeComplete && primaryImageId),
    staleTime: 0,
  });

  const appraisal = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Select a submission first.');
      if (!primaryImageId) throw new Error('Select an eligible primary stone image first.');
      if (!detailQuery.data) throw new Error('Reload the submission before appraising it.');
      const intent = `gemlab:${selected.submissionId}:appraise`;
      const result = await submitGemAppraisal({
        submissionId: selected.submissionId,
        graded: grades,
        primaryImageId,
        expectedVersion: detailQuery.data.workflow.version,
        idempotencyKey: operationIdempotencyKey(intent),
      });
      clearOperationIdempotencyKey(intent);
      return result;
    },
    onSuccess: async (result) => {
      setMessage(
        `Appraisal recorded with matrix ${result.matrixVersion}. Storage bank receipt is still required before activation.`,
      );
      setSelected(undefined);
      await queryClient.invalidateQueries({ queryKey: ['operations', 'gemlab'] });
    },
  });

  const matrixDraft = useMutation({
    mutationFn: async (event: FormEvent) => {
      event.preventDefault();
      const document = JSON.parse(matrixDocument) as Record<string, unknown>;
      const intent = `matrix:${matrixVersion}:draft`;
      const response = await createMatrixDraft({
        version: matrixVersion.trim(),
        document,
        idempotencyKey: operationIdempotencyKey(intent),
      });
      clearOperationIdempotencyKey(intent);
      return response;
    },
    onSuccess: async () => {
      setMatrixDocument('');
      setMatrixVersion('');
      await queryClient.invalidateQueries({ queryKey: ['operations', 'matrices'] });
    },
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[24px] font-medium tracking-[-0.03em] text-ink">
            Evidence and appraisal desk
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            Review certificates and stone images, then record an appraisal against the active
            matrix. Appraisal does not list or activate a stone.
          </p>
        </div>
        <StatusBadge tone="neutral" dot>
          {access?.memberships.find((entry) => entry.capabilities.includes('gemlab.read'))?.name}
        </StatusBadge>
      </header>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'queue', label: 'Stone queue', count: queueQuery.data?.length },
          ...(has('matrix.propose')
            ? ([{ key: 'matrix' as const, label: 'Valuation matrices' }] as const)
            : []),
        ]}
      />

      {tab === 'queue' ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
          <QueuePanel
            items={queueQuery.data ?? []}
            selectedId={selected?.submissionId}
            loading={queueQuery.isLoading}
            error={queueQuery.error}
            onRetry={() => void queueQuery.refetch()}
            onSelect={setSelected}
          />
          {!selected ? (
            <EmptyState
              title="Select a stone"
              hint="Its submitted certificate and image evidence will appear here for review."
            />
          ) : detailQuery.isLoading ? (
            <Skeleton className="h-[560px]" />
          ) : detailQuery.isError || !detailQuery.data ? (
            <ErrorState
              message={
                detailQuery.error instanceof Error
                  ? detailQuery.error.message
                  : 'Stone detail could not be loaded.'
              }
            />
          ) : (
            <Card className="space-y-5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-[16px] font-semibold text-ink">
                    {detailQuery.data.submission.stoneName}
                  </h3>
                  <p className="mt-1 font-mono text-[10.5px] text-ink-dim">
                    {detailQuery.data.submission.submissionId}
                  </p>
                </div>
                <StatusBadge tone="info">Matrix {detailQuery.data.matrix.version}</StatusBadge>
              </div>

              <EvidenceReview
                evidence={detailQuery.data.evidence}
                primaryImageId={primaryImageId}
                onPrimaryImage={setPrimaryImageId}
              />

              <AppraisalForm
                value={grades}
                onChange={setGrades}
                options={gradeOptions(detailQuery.data.matrix.document)}
                disabled={!has('gemlab.appraise') || appraisal.isPending || !primaryImageId}
                preview={previewQuery.data?.approvedValuationUsd}
                previewPending={previewQuery.isFetching}
                error={
                  (appraisal.error instanceof Error ? appraisal.error.message : undefined) ??
                  (previewQuery.error instanceof Error ? previewQuery.error.message : undefined)
                }
                onSubmit={(event) => {
                  event.preventDefault();
                  appraisal.mutate();
                }}
              />

              <LifecycleTracker
                title="Submission lifecycle"
                stages={sellerLifecycleStages(detailQuery.data.workflow)}
                events={eventPresentation(detailQuery.data.workflow.events)}
              />
            </Card>
          )}
        </div>
      ) : (
        <MatrixPanel
          matrices={matrixQuery.data ?? []}
          loading={matrixQuery.isLoading}
          error={matrixQuery.error}
          canPropose={has('matrix.propose')}
          version={matrixVersion}
          document={matrixDocument}
          pending={matrixDraft.isPending}
          mutationError={matrixDraft.error}
          onVersion={setMatrixVersion}
          onDocument={setMatrixDocument}
          onSubmit={(event) => matrixDraft.mutate(event)}
          onPropose={async (matrixId) => {
            await proposeMatrix(matrixId);
            await matrixQuery.refetch();
          }}
        />
      )}

      {message && (
        <p
          role="status"
          className="rounded-[4px] border border-emerald/25 bg-emerald/[0.06] p-3 text-[12px] text-emerald"
        >
          {message}
        </p>
      )}
    </div>
  );
}

function QueuePanel({
  items,
  selectedId,
  loading,
  error,
  onRetry,
  onSelect,
}: {
  items: GemLabQueueItem[];
  selectedId?: string;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (item: GemLabQueueItem) => void;
}) {
  return (
    <Card className="p-0">
      <div className="border-b border-line/[0.07] px-4 py-3">
        <h3 className="text-[13px] font-semibold text-ink">Awaiting gemological review</h3>
      </div>
      {Boolean(error) && (
        <div className="m-3 rounded-[4px] border border-ruby/25 bg-ruby/[0.05] p-3 text-[12px] text-ruby">
          Queue refresh failed.{' '}
          <button onClick={onRetry} className="font-semibold underline">
            Retry
          </button>
        </div>
      )}
      {loading && items.length === 0 ? (
        <div className="space-y-2 p-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : items.length === 0 ? (
        <p className="px-4 py-8 text-[12px] text-ink-dim">No stones currently await review.</p>
      ) : (
        <ul className="divide-y divide-line/[0.06]">
          {items.map((item) => (
            <li key={item.submissionId}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-pressed={selectedId === item.submissionId}
                className="w-full px-4 py-3.5 text-left transition-colors hover:bg-line/[0.025] aria-pressed:bg-atelier/[0.07]"
              >
                <span className="block text-[13px] font-semibold text-ink">{item.stoneName}</span>
                <span className="mt-1 block text-[11px] text-ink-muted">
                  {item.sellerName ?? 'Seller'} · {item.certificateCount ?? 0} certificates ·{' '}
                  {item.imageCount ?? 0} images
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EvidenceReview({
  evidence,
  primaryImageId,
  onPrimaryImage,
}: {
  evidence: Awaited<ReturnType<typeof loadGemLabDetail>>['evidence'];
  primaryImageId?: string;
  onPrimaryImage: (id: string) => void;
}) {
  if (evidence.length === 0) {
    return (
      <ErrorState message="No evidence is attached. An appraisal cannot be committed safely." />
    );
  }
  return (
    <section aria-labelledby="evidence-heading">
      <h4
        id="evidence-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted"
      >
        Evidence review
      </h4>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {evidence.map((file) => (
          <div key={file.id} className="rounded-[4px] border border-line/[0.08] bg-line/[0.02] p-3">
            <a
              href={file.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[12.5px] font-semibold text-ink underline underline-offset-2"
            >
              {file.fileName}
            </a>
            <p className="mt-1 text-[10.5px] text-ink-dim">
              {file.category} · {file.mimeType}
            </p>
            {file.eligibleAsPrimaryImage && (
              <label className="mt-3 flex items-center gap-2 text-[11.5px] text-ink-muted">
                <input
                  type="radio"
                  name="primary-image"
                  checked={primaryImageId === file.id}
                  onChange={() => onPrimaryImage(file.id)}
                />
                Use as primary token image
              </label>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function GradeSelect({
  label,
  value,
  choices,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  choices: string[];
  placeholder: string;
  onChange: (next: string) => void;
}) {
  // A prefilled value outside the matrix shows as unselected rather than silently kept.
  const selected = choices.find((choice) => choice.toLowerCase() === value.trim().toLowerCase());
  return (
    <Labeled label={label}>
      <select
        className={inputClass}
        value={selected ?? ''}
        onChange={(event) => onChange(event.target.value)}
        required
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {gradeLabel(choice)}
          </option>
        ))}
      </select>
    </Labeled>
  );
}

function AppraisalForm({
  value,
  onChange,
  options,
  disabled,
  preview,
  previewPending,
  error,
  onSubmit,
}: {
  value: GemGradeInput;
  onChange: (value: GemGradeInput) => void;
  options?: GradeOptions;
  disabled: boolean;
  preview?: string;
  previewPending: boolean;
  error?: string;
  onSubmit: (event: FormEvent) => void;
}) {
  const set = <K extends keyof GemGradeInput>(key: K, next: GemGradeInput[K]) =>
    onChange({ ...value, [key]: next });
  const variety = options?.varieties.find(
    (candidate) => candidate.name.toLowerCase() === value.variety.trim().toLowerCase(),
  );
  const caratField = (
    <Field
      label="Carat weight"
      type="number"
      min="0.01"
      step="0.01"
      value={value.caratWeight || ''}
      onChange={(event) => set('caratWeight', Number(event.target.value))}
      required
    />
  );
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {options ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <GradeSelect
            label="Variety"
            value={value.variety}
            choices={options.varieties.map((candidate) => candidate.name)}
            placeholder="Choose variety"
            // Colours and colour grades belong to a variety, so a change clears them.
            onChange={(next) => onChange({ ...value, variety: next, color: '', colorGrade: '' })}
          />
          {caratField}
          <GradeSelect
            label="Clarity"
            value={value.clarity}
            choices={options.clarities}
            placeholder="Choose clarity"
            onChange={(next) => set('clarity', next)}
          />
          <GradeSelect
            label="Treatment"
            value={value.treatment}
            choices={options.treatments}
            placeholder="Choose treatment"
            onChange={(next) => set('treatment', next)}
          />
          <GradeSelect
            label="Shape"
            value={value.shape}
            choices={options.shapes}
            placeholder="Choose shape"
            onChange={(next) => set('shape', next)}
          />
          <GradeSelect
            label="Color"
            value={value.color}
            choices={variety?.colors ?? []}
            placeholder={variety ? 'Choose color' : 'Choose variety first'}
            onChange={(next) => set('color', next)}
          />
          <GradeSelect
            label="Color grade"
            value={value.colorGrade}
            choices={variety?.colorGrades ?? []}
            placeholder={variety ? 'Choose color grade' : 'Choose variety first'}
            onChange={(next) => set('colorGrade', next)}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Variety"
            value={value.variety}
            onChange={(event) => set('variety', event.target.value)}
            required
          />
          {caratField}
          <Field
            label="Clarity"
            value={value.clarity}
            onChange={(event) => set('clarity', event.target.value)}
            required
          />
          <Field
            label="Treatment"
            value={value.treatment}
            onChange={(event) => set('treatment', event.target.value)}
            required
          />
          <Field
            label="Shape"
            value={value.shape}
            onChange={(event) => set('shape', event.target.value)}
            required
          />
          <Field
            label="Color"
            value={value.color}
            onChange={(event) => set('color', event.target.value)}
            required
          />
          <Field
            label="Color grade"
            value={value.colorGrade}
            onChange={(event) => set('colorGrade', event.target.value)}
            required
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-[12px] text-ruby">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/[0.07] pt-4">
        <p className="text-[12px] text-ink-muted">
          {previewPending
            ? 'Calculating with the active matrix…'
            : preview
              ? `Server preview: ${preview} base units`
              : 'Choose a primary image and complete every grade to request a server preview.'}
        </p>
        <Button type="submit" disabled={disabled || !preview}>
          Record appraisal
        </Button>
      </div>
    </form>
  );
}

function MatrixPanel({
  matrices,
  loading,
  error,
  canPropose,
  version,
  document,
  pending,
  mutationError,
  onVersion,
  onDocument,
  onSubmit,
  onPropose,
}: {
  matrices: Awaited<ReturnType<typeof loadAppraisalMatrices>>;
  loading: boolean;
  error: unknown;
  canPropose: boolean;
  version: string;
  document: string;
  pending: boolean;
  mutationError: unknown;
  onVersion: (value: string) => void;
  onDocument: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onPropose: (matrixId: string) => Promise<void>;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.7fr)]">
      <Card className="p-0">
        <div className="border-b border-line/[0.07] px-4 py-3">
          <h3 className="text-[13px] font-semibold text-ink">Version history</h3>
        </div>
        {loading ? (
          <div className="p-3">
            <Skeleton className="h-32" />
          </div>
        ) : error ? (
          <ErrorState message={error instanceof Error ? error.message : undefined} />
        ) : matrices.length === 0 ? (
          <p className="px-4 py-8 text-[12px] text-ink-dim">No matrix versions exist.</p>
        ) : (
          <ul className="divide-y divide-line/[0.06]">
            {matrices.map((matrix) => (
              <li
                key={matrix.id ?? matrix.hash}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
              >
                <div>
                  <p className="text-[13px] font-semibold text-ink">{matrix.version}</p>
                  <p className="mt-1 font-mono text-[10px] text-ink-dim">{matrix.hash}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    tone={
                      matrix.state === 'active'
                        ? 'success'
                        : matrix.state === 'proposed'
                          ? 'info'
                          : 'neutral'
                    }
                  >
                    {matrix.state}
                  </StatusBadge>
                  {canPropose && matrix.state === 'draft' && matrix.id && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void onPropose(matrix.id!)}
                    >
                      Propose
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canPropose && (
        <Card className="p-5">
          <h3 className="text-[14px] font-semibold text-ink">Create matrix draft</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            Drafts do not affect appraisals until an administrator activates a proposed version.
          </p>
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <Field
              label="Version"
              value={version}
              onChange={(event) => onVersion(event.target.value)}
              required
            />
            <Labeled label="Canonical matrix JSON">
              <textarea
                className={`${inputClass} min-h-56 py-3 font-mono text-[11px]`}
                value={document}
                onChange={(event) => onDocument(event.target.value)}
                required
              />
            </Labeled>
            {Boolean(mutationError) && (
              <p role="alert" className="text-[12px] text-ruby">
                {mutationError instanceof Error
                  ? mutationError.message
                  : 'Draft could not be created.'}
              </p>
            )}
            <Button type="submit" disabled={pending || !version.trim() || !document.trim()}>
              {pending ? 'Saving…' : 'Save immutable draft'}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

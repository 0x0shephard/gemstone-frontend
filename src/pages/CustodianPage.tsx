import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OperationsAccessGate } from '@/components/operations/OperationsAccessGate';
import { EvidenceUpload } from '@/components/operations/EvidenceUpload';
import { LifecycleTracker } from '@/components/operations/LifecycleTracker';
import {
  eventPresentation,
  redemptionLifecycleStages,
} from '@/components/operations/lifecyclePresentation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useOperationsAccess } from '@/hooks/useOperationsAccess';
import {
  clearOperationIdempotencyKey,
  confirmVaultCollection,
  listRedemptionTrackers,
  loadRedemptionTracker,
  operationIdempotencyKey,
  recordCustodianDispatch,
  recordRedemptionArrival,
  releaseRedemptionOwnerCode,
  type EvidenceCategory,
  type RedemptionTracker,
  type WorkflowEvidenceView,
} from '@/services/offchain/operations';

export default function CustodianPage() {
  return (
    <OperationsAccessGate capability="custodian.fulfill">
      <CustodianWorkspace />
    </OperationsAccessGate>
  );
}

function CustodianWorkspace() {
  const { data: access } = useOperationsAccess();
  const organizationId = access?.memberships.find((entry) =>
    entry.capabilities.includes('custodian.fulfill'),
  )?.organizationId;
  const [selectedId, setSelectedId] = useState<string>();
  const queue = useQuery({
    queryKey: ['operations', 'redemption', 'custodian', organizationId],
    queryFn: () => listRedemptionTrackers('custodian', organizationId),
    enabled: Boolean(organizationId),
    placeholderData: (previous) => previous,
  });
  const detail = useQuery({
    queryKey: ['operations', 'redemption', 'detail', selectedId, organizationId],
    queryFn: () => loadRedemptionTracker(selectedId!, organizationId),
    enabled: Boolean(selectedId && organizationId),
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[24px] font-medium tracking-[-0.03em] text-ink">
            Custodian vault
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            Confirm accepted redemption requests, dispatch the stones and record their arrival. The
            customer then confirms the handover with their emailed code.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void queue.refetch()}
          disabled={queue.isFetching}
        >
          {queue.isFetching ? 'Refreshing…' : 'Refresh queue'}
        </Button>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,.7fr)_minmax(0,1.3fr)]">
        <Card className="p-0">
          <div className="border-b border-line/[0.07] px-4 py-3">
            <h3 className="text-[13px] font-semibold text-ink">Assigned requests</h3>
          </div>
          {queue.isLoading && !queue.data ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : queue.isError && !queue.data ? (
            <ErrorState message={queue.error instanceof Error ? queue.error.message : undefined} />
          ) : (queue.data ?? []).length === 0 ? (
            <p className="px-4 py-8 text-[12px] text-ink-dim">
              No accepted redemption requests are assigned to this vault.
            </p>
          ) : (
            <ul className="divide-y divide-line/[0.06]">
              {queue.data!.map((request) => (
                <li key={request.id}>
                  <button
                    type="button"
                    aria-pressed={selectedId === request.id}
                    onClick={() => setSelectedId(request.id)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-line/[0.025] aria-pressed:bg-atelier/[0.07]"
                  >
                    <span>
                      <span className="block text-[13px] font-semibold text-ink">
                        {request.gem?.name ?? `Token #${request.tokenId}`}
                      </span>
                      <span className="mt-1 block text-[11px] text-ink-muted">
                        {request.method === 'pickup' ? 'Pickup' : 'Insured delivery'} ·{' '}
                        {request.requestedAt
                          ? new Date(request.requestedAt).toLocaleDateString()
                          : 'Requested'}
                      </span>
                    </span>
                    <StatusBadge tone="neutral">{request.status.replaceAll('_', ' ')}</StatusBadge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {!selectedId ? (
          <EmptyState
            title="Select a fulfillment request"
            hint="Only actions legal for its current server state will appear."
          />
        ) : detail.isLoading ? (
          <Skeleton className="h-[560px]" />
        ) : detail.isError || !detail.data ? (
          <ErrorState message={detail.error instanceof Error ? detail.error.message : undefined} />
        ) : (
          <FulfillmentDetail
            request={detail.data}
            organizationId={organizationId!}
            onReload={() => void detail.refetch()}
          />
        )}
      </div>
    </div>
  );
}

function FulfillmentDetail({
  request,
  organizationId,
  onReload,
}: {
  request: RedemptionTracker;
  organizationId: string;
  onReload: () => void;
}) {
  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">
            {request.gem?.name ?? `Token #${request.tokenId}`}
          </h3>
          <p className="mt-1 font-mono text-[10px] text-ink-dim">{request.id}</p>
        </div>
        <StatusBadge tone="info">
          {request.method === 'pickup' ? 'Pickup route' : 'Courier route'}
        </StatusBadge>
      </div>
      <LifecycleTracker
        title="Fulfillment lifecycle"
        stages={redemptionLifecycleStages(request)}
        events={eventPresentation(request.events ?? [])}
      />
      <FulfillmentActions request={request} organizationId={organizationId} onReload={onReload} />
    </Card>
  );
}

function FulfillmentActions({
  request,
  organizationId,
  onReload,
}: {
  request: RedemptionTracker;
  organizationId: string;
  onReload: () => void;
}) {
  const queryClient = useQueryClient();
  const [evidence, setEvidence] = useState<WorkflowEvidenceView>();
  const [note, setNote] = useState('');
  const [dispatchedAt, setDispatchedAt] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingReference, setTrackingReference] = useState('');
  const [arrivedAt, setArrivedAt] = useState('');
  const [location, setLocation] = useState('');
  const capabilities = new Set(request.capabilities ?? []);
  const pickup = request.method === 'pickup';

  const reload = async () => {
    setEvidence(undefined);
    await queryClient.invalidateQueries({ queryKey: ['operations', 'redemption'] });
    onReload();
  };

  /*
   * Each step keeps its idempotency key until the server confirms it, so a
   * retry after a timeout resumes the same server-signed transaction instead of
   * sending a second one.
   */
  const collect = useMutation({
    mutationFn: async (event: FormEvent) => {
      event.preventDefault();
      const intent = `custodian:${request.id}:collect`;
      const result = await confirmVaultCollection({
        requestId: request.id,
        organizationId,
        expectedVersion: request.version,
        note: note.trim() || undefined,
        idempotencyKey: operationIdempotencyKey(intent),
      });
      clearOperationIdempotencyKey(intent);
      return result;
    },
    onSuccess: reload,
  });
  const dispatch = useMutation({
    mutationFn: async (event: FormEvent) => {
      event.preventDefault();
      if (!evidence) throw new Error('Upload dispatch evidence first.');
      const intent = `custodian:${request.id}:dispatch`;
      const result = await recordCustodianDispatch({
        requestId: request.id,
        organizationId,
        expectedVersion: request.version,
        evidenceId: evidence.id,
        dispatchedAt: new Date(dispatchedAt).toISOString(),
        carrier: carrier.trim() || undefined,
        trackingReference: trackingReference.trim() || undefined,
        idempotencyKey: operationIdempotencyKey(intent),
      });
      clearOperationIdempotencyKey(intent);
      return result;
    },
    onSuccess: reload,
  });
  const releaseCode = useMutation({
    mutationFn: async (expectedVersion: number) => {
      const intent = `custodian:${request.id}:release-code`;
      const result = await releaseRedemptionOwnerCode({
        requestId: request.id,
        organizationId,
        expectedVersion,
        idempotencyKey: operationIdempotencyKey(intent),
      });
      clearOperationIdempotencyKey(intent);
      return result;
    },
    onSettled: reload,
  });
  const arrival = useMutation({
    mutationFn: async (event: FormEvent) => {
      event.preventDefault();
      if (!evidence) throw new Error('Upload arrival evidence first.');
      const intent = `custodian:${request.id}:arrival`;
      const result = await recordRedemptionArrival({
        requestId: request.id,
        organizationId,
        expectedVersion: request.version,
        evidenceId: evidence.id,
        arrivedAt: new Date(arrivedAt).toISOString(),
        location: location.trim(),
        idempotencyKey: operationIdempotencyKey(intent),
      });
      clearOperationIdempotencyKey(intent);
      return result;
    },
    // The holder's code goes out as soon as the arrival proof is on-chain.
    onSuccess: (result) => releaseCode.mutate(result.request.version),
  });

  if (capabilities.has('custodian_collect')) {
    return (
      <form
        onSubmit={(event) => collect.mutate(event)}
        className="space-y-4 border-t border-line/[0.07] pt-4"
      >
        <div>
          <h4 className="text-[13px] font-semibold text-ink">Confirm the redemption request</h4>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
            Digital Carat accepted this request. Confirm that the vault has it and will prepare the
            stone. The protocol records this on-chain for you; no wallet is needed.
          </p>
        </div>
        <Field
          label="Note, optional"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
        />
        <ActionError error={collect.error} />
        <Button type="submit" disabled={collect.isPending}>
          {collect.isPending ? 'Recording on-chain…' : 'Confirm request receipt'}
        </Button>
      </form>
    );
  }
  if (capabilities.has('custodian_dispatch')) {
    return (
      <ActionForm
        title="Record dispatch from the vault"
        category="custodian_dispatch"
        requestId={request.id}
        organizationId={organizationId}
        evidence={evidence}
        onEvidence={setEvidence}
        error={dispatch.error}
        pending={dispatch.isPending}
        onSubmit={(event) => dispatch.mutate(event)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Dispatched at"
            type="datetime-local"
            value={dispatchedAt}
            onChange={(event) => setDispatchedAt(event.target.value)}
            required
          />
          <Field
            label="Carrier, optional"
            value={carrier}
            onChange={(event) => setCarrier(event.target.value)}
          />
          <Field
            label="Tracking reference, optional"
            value={trackingReference}
            onChange={(event) => setTrackingReference(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={dispatch.isPending || !evidence || !dispatchedAt}>
          {dispatch.isPending ? 'Recording…' : 'Record dispatch'}
        </Button>
      </ActionForm>
    );
  }
  if (capabilities.has('record_arrival')) {
    return (
      <ActionForm
        title={pickup ? 'Record arrival at the pickup point' : 'Record arrival with the customer'}
        category="redemption_arrival"
        requestId={request.id}
        organizationId={organizationId}
        evidence={evidence}
        onEvidence={setEvidence}
        error={arrival.error}
        pending={arrival.isPending}
        onSubmit={(event) => arrival.mutate(event)}
      >
        <p className="text-[11.5px] leading-relaxed text-ink-muted">
          Recording the arrival submits it on-chain as the fulfillment proof and emails the customer
          a one-time code. They enter it in their portal when the stone is handed over.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Arrived at"
            type="datetime-local"
            value={arrivedAt}
            onChange={(event) => setArrivedAt(event.target.value)}
            required
          />
          <Field
            label={pickup ? 'Pickup point' : 'Delivery address'}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            required
          />
        </div>
        <Button
          type="submit"
          disabled={arrival.isPending || !evidence || !arrivedAt || location.trim().length < 2}
        >
          {arrival.isPending ? 'Recording on-chain…' : 'Record arrival'}
        </Button>
      </ActionForm>
    );
  }
  if (capabilities.has('release_owner_code')) {
    return (
      <div className="space-y-3 border-t border-line/[0.07] pt-4">
        <h4 className="text-[13px] font-semibold text-ink">Send the customer their code</h4>
        <p className="text-[11.5px] leading-relaxed text-ink-muted">
          The arrival is recorded. Approving it on-chain emails the customer the code they enter
          when the stone is handed over.
        </p>
        <ActionError error={releaseCode.error} />
        <Button
          onClick={() => releaseCode.mutate(request.version)}
          disabled={releaseCode.isPending}
        >
          {releaseCode.isPending ? 'Sending…' : 'Approve arrival and send code'}
        </Button>
      </div>
    );
  }
  if (request.status === 'proof_approved') {
    return (
      <p className="rounded-[4px] border border-line/[0.08] bg-line/[0.02] p-4 text-[12px] text-ink-muted">
        The customer has their code. Hand the stone over once they confirm it in their portal.
      </p>
    );
  }
  return (
    <p className="rounded-[4px] border border-line/[0.08] bg-line/[0.02] p-4 text-[12px] text-ink-muted">
      No vault action is needed in the current state. Refresh after the next step is completed.
    </p>
  );
}

function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[12px] text-ruby">
      {error instanceof Error ? error.message : 'The action could not be completed.'}
    </p>
  );
}

function ActionForm({
  title,
  category,
  requestId,
  organizationId,
  evidence,
  onEvidence,
  error,
  children,
  onSubmit,
}: {
  title: string;
  category: EvidenceCategory;
  requestId: string;
  organizationId: string;
  evidence?: WorkflowEvidenceView;
  onEvidence: (evidence: WorkflowEvidenceView) => void;
  error: unknown;
  pending: boolean;
  children: React.ReactNode;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4 border-t border-line/[0.07] pt-4">
      <h4 className="text-[13px] font-semibold text-ink">{title}</h4>
      <EvidenceUpload
        requestId={requestId}
        organizationId={organizationId}
        category={category}
        label={`${title} evidence`}
        onUploaded={onEvidence}
      />
      {evidence && (
        <p role="status" className="text-[11.5px] text-emerald">
          Verified evidence {evidence.sha256.slice(0, 16)}…
        </p>
      )}
      {children}
      {Boolean(error) && (
        <p role="alert" className="text-[12px] text-ruby">
          {error instanceof Error ? error.message : 'The action could not be prepared.'}
        </p>
      )}
    </form>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
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
import { TxButton } from '@/components/tx/TxButton';
import { dataService } from '@/services';
import { useOperationsAccess } from '@/hooks/useOperationsAccess';
import {
  clearOperationIdempotencyKey,
  listRedemptionTrackers,
  loadRedemptionTracker,
  operationIdempotencyKey,
  prepareCustodianCollection,
  prepareDeliveryProof,
  preparePickupProof,
  recordCustodianDispatch,
  resumeRedemptionActionIntent,
  type EvidenceCategory,
  type RedemptionMutationResult,
  type RedemptionTracker,
  type WorkflowEvidenceView,
} from '@/services/offchain/operations';
import { useAccount } from 'wagmi';

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
            Custodian fulfillment
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            Record collection and dispatch evidence, then submit proof of physical handover for
            independent admin approval.
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
              No fulfillment requests are assigned to this custodian.
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
                        {request.method === 'pickup' ? 'Bank pickup' : 'Insured courier'} ·{' '}
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
  const { address } = useAccount();
  const [evidence, setEvidence] = useState<WorkflowEvidenceView>();
  const [collectedAt, setCollectedAt] = useState('');
  const [location, setLocation] = useState('');
  const [dispatchedAt, setDispatchedAt] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingReference, setTrackingReference] = useState('');
  const [deliveredAt, setDeliveredAt] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [prepared, setPrepared] = useState<{
    kind: 'collect' | 'proof' | 'pickup-proof';
    intent: string;
    storageKey?: string;
    result: RedemptionMutationResult;
    payload: Record<string, unknown>;
  }>();
  const capabilities = new Set(request.capabilities ?? []);
  const resumableAction = capabilities.has('custodian_collect')
    ? 'custodian_collect'
    : capabilities.has('submit_delivery_proof')
      ? 'submit_delivery_proof'
      : capabilities.has('submit_pickup_proof')
        ? 'submit_pickup_proof'
        : undefined;
  const pendingAction = useQuery({
    queryKey: ['operations', 'redemption', request.id, 'pending-action', resumableAction],
    queryFn: () =>
      resumeRedemptionActionIntent({
        requestId: request.id,
        intentAction: resumableAction!,
        organizationId,
      }),
    enabled: Boolean(resumableAction),
  });

  useEffect(() => {
    const pending = pendingAction.data;
    if (!pending || prepared) return;
    const kind =
      pending.action === 'custodian_collect'
        ? 'collect'
        : pending.action === 'submit_pickup_proof'
          ? 'pickup-proof'
          : 'proof';
    setPrepared({
      kind,
      intent: pending.idempotencyKey,
      payload: pending.payload,
      result: {
        request,
        chainAction: kind === 'collect' ? 'startFulfillment' : 'submitFulfillmentProof',
        args: pending.chainArguments,
      },
    });
  }, [pendingAction.data, prepared, request]);

  const reload = async () => {
    setEvidence(undefined);
    setPrepared(undefined);
    await queryClient.invalidateQueries({ queryKey: ['operations', 'redemption'] });
    onReload();
  };

  const collect = useMutation({
    mutationFn: async (event: FormEvent) => {
      event.preventDefault();
      if (!evidence) throw new Error('Upload collection evidence first.');
      if (!address) throw new Error('Connect the verified custodian wallet.');
      const intent = `custodian:${request.id}:collect`;
      const idempotencyKey = operationIdempotencyKey(intent);
      return prepareCustodianCollection({
        requestId: request.id,
        organizationId,
        expectedVersion: request.version,
        evidenceId: evidence.id,
        collectedAt: new Date(collectedAt).toISOString(),
        location: location.trim(),
        idempotencyKey,
        actorWallet: address,
      }).then((result) => ({ result, idempotencyKey, storageKey: intent }));
    },
    onSuccess: ({ result, idempotencyKey, storageKey }) =>
      setPrepared({
        kind: 'collect',
        intent: idempotencyKey,
        storageKey,
        result,
        payload: {
          evidenceId: evidence!.id,
          collectedAt: new Date(collectedAt).toISOString(),
          location: location.trim(),
        },
      }),
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
  const proof = useMutation({
    mutationFn: async (event: FormEvent) => {
      event.preventDefault();
      if (!evidence) throw new Error('Upload delivery proof first.');
      if (!address) throw new Error('Connect the verified custodian wallet.');
      const intent = `custodian:${request.id}:proof`;
      const idempotencyKey = operationIdempotencyKey(intent);
      return prepareDeliveryProof({
        requestId: request.id,
        organizationId,
        expectedVersion: request.version,
        evidenceId: evidence.id,
        deliveredAt: new Date(deliveredAt).toISOString(),
        recipientName: recipientName.trim(),
        idempotencyKey,
        actorWallet: address,
      }).then((result) => ({ result, idempotencyKey, storageKey: intent }));
    },
    onSuccess: ({ result, idempotencyKey, storageKey }) =>
      setPrepared({
        kind: 'proof',
        intent: idempotencyKey,
        storageKey,
        result,
        payload: {
          evidenceId: evidence!.id,
          deliveredAt: new Date(deliveredAt).toISOString(),
          recipientName: recipientName.trim(),
        },
      }),
  });
  const pickupProof = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('Connect the verified custodian wallet.');
      const intent = `custodian:${request.id}:pickup-proof`;
      const idempotencyKey = operationIdempotencyKey(intent);
      return preparePickupProof({
        requestId: request.id,
        organizationId,
        expectedVersion: request.version,
        actorWallet: address,
        idempotencyKey,
      }).then((result) => ({ result, idempotencyKey, storageKey: intent }));
    },
    onSuccess: ({ result, idempotencyKey, storageKey }) =>
      setPrepared({
        kind: 'pickup-proof',
        intent: idempotencyKey,
        storageKey,
        result,
        payload: {},
      }),
  });

  if (prepared?.result.chainAction) {
    const args = prepared.result.args;
    const tokenId = args?.tokenId ? BigInt(args.tokenId) : undefined;
    const isValid =
      tokenId !== undefined &&
      ((prepared.kind === 'collect' && prepared.result.chainAction === 'startFulfillment') ||
        ((prepared.kind === 'proof' || prepared.kind === 'pickup-proof') &&
          prepared.result.chainAction === 'submitFulfillmentProof' &&
          Boolean(args?.proofDigest)));
    return (
      <div role="status" className="rounded-[4px] border border-sapphire/25 bg-sapphire/[0.05] p-4">
        <h4 className="text-[13px] font-semibold text-sapphire">Wallet confirmation required</h4>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
          The server verified the evidence and prepared {prepared.result.chainAction}. The workflow
          has not advanced and no success is shown until the contract transaction is confirmed and
          recorded by the lifecycle service.
        </p>
        {!isValid ? (
          <p role="alert" className="mt-3 text-[12px] text-ruby">
            The prepared transaction is incomplete. Reload the request instead of signing it.
          </p>
        ) : (
          <div className="mt-3">
            <TxButton
              telemetryFlow={`redemption_${prepared.kind}`}
              action={() =>
                prepared.kind === 'collect'
                  ? dataService.startRedemptionFulfillment({ tokenId: tokenId! })
                  : dataService.submitFulfillmentProof({
                      tokenId: tokenId!,
                      proofDigest: args!.proofDigest!,
                    })
              }
              onConfirmed={async ({ hash }) => {
                if (!address) throw new Error('Reconnect the verified custodian wallet.');
                if (prepared.kind === 'collect') {
                  await prepareCustodianCollection({
                    requestId: request.id,
                    organizationId,
                    expectedVersion: request.version,
                    evidenceId: String(prepared.payload.evidenceId),
                    collectedAt: String(prepared.payload.collectedAt),
                    location: String(prepared.payload.location),
                    idempotencyKey: prepared.intent,
                    actorWallet: address,
                    transactionHash: hash,
                  });
                } else if (prepared.kind === 'pickup-proof') {
                  await preparePickupProof({
                    requestId: request.id,
                    organizationId,
                    expectedVersion: request.version,
                    idempotencyKey: prepared.intent,
                    actorWallet: address,
                    transactionHash: hash,
                  });
                } else {
                  await prepareDeliveryProof({
                    requestId: request.id,
                    organizationId,
                    expectedVersion: request.version,
                    evidenceId: String(prepared.payload.evidenceId),
                    deliveredAt: String(prepared.payload.deliveredAt),
                    recipientName: String(prepared.payload.recipientName),
                    idempotencyKey: prepared.intent,
                    actorWallet: address,
                    transactionHash: hash,
                  });
                }
                if (prepared.storageKey) clearOperationIdempotencyKey(prepared.storageKey);
              }}
              doneLabel="Return to request"
              onDone={() => void reload()}
            >
              Confirm in wallet
            </TxButton>
          </div>
        )}
        <Button className="mt-3" size="sm" variant="ghost" onClick={() => setPrepared(undefined)}>
          Review preparation again
        </Button>
      </div>
    );
  }

  if (capabilities.has('custodian_collect')) {
    return (
      <ActionForm
        title="Record physical collection"
        category="custodian_collection"
        requestId={request.id}
        organizationId={organizationId}
        evidence={evidence}
        onEvidence={setEvidence}
        error={collect.error}
        pending={collect.isPending}
        onSubmit={(event) => collect.mutate(event)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Collected at"
            type="datetime-local"
            value={collectedAt}
            onChange={(event) => setCollectedAt(event.target.value)}
            required
          />
          <Field
            label="Collection location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            required
          />
        </div>
        <Button
          type="submit"
          disabled={collect.isPending || !evidence || !collectedAt || !location.trim()}
        >
          {collect.isPending ? 'Preparing…' : 'Prepare collection transaction'}
        </Button>
      </ActionForm>
    );
  }
  if (capabilities.has('custodian_dispatch')) {
    return (
      <ActionForm
        title="Record secure dispatch"
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
  if (capabilities.has('submit_delivery_proof')) {
    return (
      <ActionForm
        title="Submit proof of handover"
        category="courier_delivery"
        requestId={request.id}
        organizationId={organizationId}
        evidence={evidence}
        onEvidence={setEvidence}
        error={proof.error}
        pending={proof.isPending}
        onSubmit={(event) => proof.mutate(event)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Delivered at"
            type="datetime-local"
            value={deliveredAt}
            onChange={(event) => setDeliveredAt(event.target.value)}
            required
          />
          <Field
            label="Recipient name on proof"
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
            required
          />
        </div>
        <Button
          type="submit"
          disabled={proof.isPending || !evidence || !deliveredAt || !recipientName.trim()}
        >
          {proof.isPending ? 'Preparing…' : 'Prepare proof transaction'}
        </Button>
      </ActionForm>
    );
  }
  if (capabilities.has('submit_pickup_proof')) {
    return (
      <div className="space-y-3 border-t border-line/[0.07] pt-4">
        <h4 className="text-[13px] font-semibold text-ink">Submit verified pickup proof</h4>
        <p className="text-[11.5px] leading-relaxed text-ink-muted">
          The bank recorded the witnessed handover. Submit its request-bound proof digest on-chain;
          this still requires independent admin approval before the owner receives a code.
        </p>
        {pickupProof.error && (
          <p role="alert" className="text-[12px] text-ruby">
            {pickupProof.error instanceof Error
              ? pickupProof.error.message
              : 'Pickup proof could not be prepared.'}
          </p>
        )}
        <Button onClick={() => pickupProof.mutate()} disabled={pickupProof.isPending || !address}>
          {pickupProof.isPending ? 'Preparing…' : 'Prepare pickup proof transaction'}
        </Button>
      </div>
    );
  }
  return (
    <p className="rounded-[4px] border border-line/[0.08] bg-line/[0.02] p-4 text-[12px] text-ink-muted">
      No custodian action is legal in the current state. Refresh after another party completes the
      next step.
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

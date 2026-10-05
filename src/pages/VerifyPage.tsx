import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OperationsAccessGate } from '@/components/operations/OperationsAccessGate';
import { LifecycleTracker } from '@/components/operations/LifecycleTracker';
import {
  eventPresentation,
  redemptionLifecycleStages,
  sellerLifecycleStages,
} from '@/components/operations/lifecyclePresentation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Labeled, inputClass } from '@/components/ui/Field';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { EvidenceUpload } from '@/components/operations/EvidenceUpload';
import {
  activateMatrix,
  approveRedemptionProof,
  assignRedemption,
  clearOperationIdempotencyKey,
  correctWorkflow,
  loadAdminOverview,
  loadAppraisalMatrices,
  loadRedemptionTracker,
  operationIdempotencyKey,
  startSellerActivation,
  resumeRedemptionActionIntent,
  rejectRedemptionProof,
  mutateRedemptionRecovery,
  type RedemptionTracker,
  type OperationsOrganization,
  type SellerWorkflowView,
  type WorkflowEvidenceView,
  type WorkflowKind,
} from '@/services/offchain/operations';
import { useOperationsAccess } from '@/hooks/useOperationsAccess';
import { TxButton } from '@/components/tx/TxButton';
import { dataService } from '@/services';
import type { RedemptionMutationResult } from '@/services/offchain/operations';
import { useAccount } from 'wagmi';

type AdminTab = 'seller' | 'redemption' | 'matrix';

export default function VerifyPage() {
  return (
    <OperationsAccessGate capability="admin.read">
      <AdminWorkspace />
    </OperationsAccessGate>
  );
}

function AdminWorkspace() {
  const { has } = useOperationsAccess();
  const [tab, setTab] = useState<AdminTab>('seller');
  const [selectedSellerId, setSelectedSellerId] = useState<string>();
  const [selectedRedemptionId, setSelectedRedemptionId] = useState<string>();
  const overview = useQuery({
    queryKey: ['operations', 'admin', 'overview'],
    queryFn: loadAdminOverview,
    placeholderData: (previous) => previous,
  });

  if (overview.isLoading && !overview.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (overview.isError && !overview.data) {
    return (
      <ErrorState message={overview.error instanceof Error ? overview.error.message : undefined} />
    );
  }
  const data = overview.data ?? {
    sellerWorkflows: [],
    redemptionWorkflows: [],
    matrices: [],
    organizations: [],
  };
  const selectedSeller = data.sellerWorkflows.find((item) => item.workflowId === selectedSellerId);
  const selectedRedemption = data.redemptionWorkflows.find(
    (item) => item.id === selectedRedemptionId,
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[24px] font-medium tracking-[-0.03em] text-ink">
            Protocol operations review
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            Review seller and redemption lifecycles from their append-only event streams.
            Corrections remain visible beside the records they supersede.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void overview.refetch()}
          disabled={overview.isFetching}
        >
          {overview.isFetching ? 'Refreshing…' : 'Refresh from source'}
        </Button>
      </header>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'seller', label: 'Seller lifecycles', count: data.sellerWorkflows.length },
          {
            key: 'redemption',
            label: 'Redemption lifecycles',
            count: data.redemptionWorkflows.length,
          },
          { key: 'matrix', label: 'Matrix activation' },
        ]}
      />
      {tab === 'seller' && (
        <WorkflowSplit
          items={data.sellerWorkflows.map((workflow) => ({
            id: workflow.workflowId,
            title: workflow.stoneName ?? `Submission ${workflow.submissionId.slice(0, 8)}`,
            subtitle: workflow.sellerName ?? workflow.submissionId,
            status: workflow.state,
            legacy: workflow.legacyBaseline,
          }))}
          empty="No seller lifecycle projections exist."
          selectedId={selectedSellerId}
          onSelect={setSelectedSellerId}
        >
          {selectedSeller ? (
            <SellerReview workflow={selectedSeller} canCorrect={has('admin.correct')} />
          ) : (
            <EmptyState
              title="Select a seller workflow"
              hint="Review explicit appraisal, bank receipt and activation events."
            />
          )}
        </WorkflowSplit>
      )}
      {tab === 'redemption' && (
        <WorkflowSplit
          items={data.redemptionWorkflows.map((workflow) => ({
            id: workflow.id,
            title: workflow.gem?.name ?? `Token #${workflow.tokenId}`,
            subtitle: `Token #${workflow.tokenId} · ${workflow.method === 'pickup' ? 'Pickup' : 'Courier'}`,
            status: workflow.status,
            legacy: false,
          }))}
          empty="No redemption lifecycle projections exist."
          selectedId={selectedRedemptionId}
          onSelect={setSelectedRedemptionId}
        >
          {selectedRedemption ? (
            <RedemptionReview
              workflow={selectedRedemption}
              canCorrect={has('admin.correct')}
              organizations={data.organizations}
            />
          ) : (
            <EmptyState
              title="Select a redemption workflow"
              hint="Review delivery proof, owner authorization and chain finalization."
            />
          )}
        </WorkflowSplit>
      )}
      {tab === 'matrix' && <MatrixActivation canActivate={has('matrix.activate')} />}
    </div>
  );
}

function WorkflowSplit({
  items,
  empty,
  selectedId,
  onSelect,
  children,
}: {
  items: Array<{ id: string; title: string; subtitle: string; status: string; legacy: boolean }>;
  empty: string;
  selectedId?: string;
  onSelect: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,.7fr)_minmax(0,1.3fr)]">
      <Card className="p-0">
        {items.length === 0 ? (
          <p className="px-4 py-8 text-[12px] text-ink-dim">{empty}</p>
        ) : (
          <ul className="divide-y divide-line/[0.06]">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={selectedId === item.id}
                  onClick={() => onSelect(item.id)}
                  className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-line/[0.025] aria-pressed:bg-atelier/[0.07]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink">
                      {item.title}
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-ink-muted">
                      {item.subtitle}
                    </span>
                    {item.legacy && (
                      <span className="mt-1 block text-[10px] text-amber">
                        Legacy baseline, evidence not inferred
                      </span>
                    )}
                  </span>
                  <StatusBadge tone="neutral" className="shrink-0">
                    {item.status.replaceAll('_', ' ')}
                  </StatusBadge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {children}
    </div>
  );
}

function SellerReview({
  workflow,
  canCorrect,
}: {
  workflow: SellerWorkflowView;
  canCorrect: boolean;
}) {
  const queryClient = useQueryClient();
  const activate = useMutation({
    mutationFn: async () => {
      const intent = `admin:seller:${workflow.workflowId}:activation`;
      const response = await startSellerActivation({
        submissionId: workflow.submissionId,
        expectedVersion: workflow.version,
        idempotencyKey: operationIdempotencyKey(intent),
      });
      clearOperationIdempotencyKey(intent);
      return response;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operations', 'admin'] }),
  });
  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">
            {workflow.stoneName ?? 'Seller workflow'}
          </h3>
          <p className="mt-1 font-mono text-[10px] text-ink-dim">{workflow.workflowId}</p>
        </div>
        {workflow.bankReceivedAt ? (
          <StatusBadge tone="success">Bank receipt verified</StatusBadge>
        ) : (
          <StatusBadge tone="warning">Awaiting bank receipt</StatusBadge>
        )}
      </div>
      <LifecycleTracker
        title="Seller lifecycle"
        stages={sellerLifecycleStages(workflow)}
        events={eventPresentation(workflow.events)}
      />
      {workflow.nextActions.includes('start_seller_activation') && (
        <div className="border-t border-line/[0.07] pt-4">
          <p className="mb-3 text-[12px] leading-relaxed text-ink-muted">
            Activation rechecks the immutable appraisal and authoritative bank receipt. It does not
            trust the browser display.
          </p>
          <Button onClick={() => activate.mutate()} disabled={activate.isPending}>
            {activate.isPending ? 'Starting…' : 'Start protocol activation'}
          </Button>
        </div>
      )}
      {activate.error && (
        <p role="alert" className="text-[12px] text-ruby">
          {activate.error instanceof Error ? activate.error.message : 'Activation could not start.'}
        </p>
      )}
      {canCorrect && (
        <CorrectionForm
          kind="seller"
          workflowId={workflow.workflowId}
          version={workflow.version}
          events={workflow.events}
        />
      )}
    </Card>
  );
}

export function RedemptionReview({
  workflow,
  canCorrect,
  organizations = [],
}: {
  workflow: RedemptionTracker;
  canCorrect: boolean;
  organizations?: OperationsOrganization[];
}) {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const { data: access } = useOperationsAccess();
  const organizationId = access?.memberships.find((entry) =>
    entry.capabilities.includes('admin.read'),
  )?.organizationId;
  const approvalOrganizationId = access?.memberships.find((entry) =>
    entry.capabilities.includes('redemption.approve'),
  )?.organizationId;
  const detailQuery = useQuery({
    queryKey: ['operations', 'redemption', 'detail', workflow.id, organizationId],
    queryFn: () => loadRedemptionTracker(workflow.id, organizationId),
    enabled: Boolean(organizationId),
  });
  const detail = detailQuery.data ?? workflow;
  const [prepared, setPrepared] = useState<{
    intent: string;
    storageKey?: string;
    result: RedemptionMutationResult;
  }>();
  const [rejectionReason, setRejectionReason] = useState('');
  const [preparedRejection, setPreparedRejection] = useState<{
    intent: string;
    storageKey?: string;
    reason: string;
    result: RedemptionMutationResult;
  }>();
  const [custodianOrganizationId, setCustodianOrganizationId] = useState(
    workflow.assignment?.custodianOrganizationId ?? '',
  );
  const [bankOrganizationId, setBankOrganizationId] = useState(
    workflow.assignment?.bankOrganizationId ?? '',
  );
  useEffect(() => {
    setCustodianOrganizationId(detail.assignment?.custodianOrganizationId ?? '');
    setBankOrganizationId(detail.assignment?.bankOrganizationId ?? '');
  }, [detail.assignment?.bankOrganizationId, detail.assignment?.custodianOrganizationId]);
  const assignment = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error('Admin organization is unavailable.');
      if (!custodianOrganizationId) throw new Error('Choose an active custodian.');
      if (detail.method === 'pickup' && !bankOrganizationId) {
        throw new Error('Pickup redemptions require an active storage bank.');
      }
      const storageKey = `admin:redemption:${detail.id}:assignment:${detail.version}`;
      const response = await assignRedemption({
        organizationId,
        requestId: detail.id,
        expectedVersion: detail.version,
        custodianOrganizationId,
        bankOrganizationId: bankOrganizationId || null,
        idempotencyKey: operationIdempotencyKey(storageKey),
      });
      clearOperationIdempotencyKey(storageKey);
      return response;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operations'] }),
  });
  const pendingApproval = useQuery({
    queryKey: ['operations', 'redemption', workflow.id, 'pending-action', 'approval'],
    queryFn: () =>
      resumeRedemptionActionIntent({
        requestId: workflow.id,
        intentAction: 'approve_fulfillment_proof',
        organizationId: approvalOrganizationId,
      }),
    enabled: Boolean(
      approvalOrganizationId && detail.capabilities?.includes('approve_fulfillment_proof'),
    ),
  });
  useEffect(() => {
    if (!pendingApproval.data || prepared) return;
    setPrepared({
      intent: pendingApproval.data.idempotencyKey,
      result: {
        request: detail,
        chainAction: 'approveFulfillmentProof',
        args: pendingApproval.data.chainArguments,
      },
    });
  }, [detail, pendingApproval.data, prepared]);
  const pendingRejection = useQuery({
    queryKey: ['operations', 'redemption', workflow.id, 'pending-action', 'rejection'],
    queryFn: () =>
      resumeRedemptionActionIntent({
        requestId: workflow.id,
        intentAction: 'reject_fulfillment_proof',
        organizationId: approvalOrganizationId,
      }),
    enabled: Boolean(
      approvalOrganizationId && detail.capabilities?.includes('reject_fulfillment_proof'),
    ),
  });
  useEffect(() => {
    if (!pendingRejection.data || preparedRejection) return;
    setPreparedRejection({
      intent: pendingRejection.data.idempotencyKey,
      reason: String(pendingRejection.data.payload.reason ?? ''),
      result: {
        request: detail,
        chainAction: 'rejectFulfillmentProof',
        args: pendingRejection.data.chainArguments,
      },
    });
  }, [detail, pendingRejection.data, preparedRejection]);
  const approval = useMutation({
    mutationFn: async () => {
      if (!approvalOrganizationId) {
        throw new Error('This organization cannot approve redemption proof.');
      }
      if (!address) throw new Error('Connect the verified proof-approver wallet.');
      const intent = `admin:redemption:${workflow.id}:proof:${detail.version}`;
      const idempotencyKey = operationIdempotencyKey(intent);
      const response = await approveRedemptionProof({
        requestId: workflow.id,
        organizationId: approvalOrganizationId,
        expectedVersion: detail.version,
        idempotencyKey,
        approverWallet: address,
      });
      return { intent: idempotencyKey, storageKey: intent, result: response };
    },
    onSuccess: setPrepared,
  });
  const preparedArgs = prepared?.result.args;
  const preparedValid =
    prepared?.result.chainAction === 'approveFulfillmentProof' &&
    Boolean(preparedArgs?.tokenId && preparedArgs.approvalId && preparedArgs.approvalVersion);
  const rejection = useMutation({
    mutationFn: async () => {
      if (!approvalOrganizationId || !address) {
        throw new Error('Connect the verified proof-approver wallet.');
      }
      const reason = rejectionReason.trim();
      if (reason.length < 10)
        throw new Error('Enter a rejection reason of at least 10 characters.');
      const storageKey = `admin:redemption:${workflow.id}:reject:${detail.version}`;
      const intent = operationIdempotencyKey(storageKey);
      const result = await rejectRedemptionProof({
        requestId: workflow.id,
        organizationId: approvalOrganizationId,
        expectedVersion: detail.version,
        idempotencyKey: intent,
        approverWallet: address,
        reason,
      });
      return { intent, storageKey, reason, result };
    },
    onSuccess: setPreparedRejection,
  });
  const rejectionArgs = preparedRejection?.result.args;
  const rejectionValid =
    preparedRejection?.result.chainAction === 'rejectFulfillmentProof' &&
    Boolean(rejectionArgs?.tokenId && rejectionArgs.reasonHash);
  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">
            {detail.gem?.name ?? `Token #${detail.tokenId}`}
          </h3>
          <p className="mt-1 font-mono text-[10px] text-ink-dim">{detail.id}</p>
        </div>
        <StatusBadge tone="info">
          {detail.method === 'pickup' ? 'Bank pickup' : 'Insured courier'}
        </StatusBadge>
      </div>
      <LifecycleTracker
        title="Redemption lifecycle"
        stages={redemptionLifecycleStages(detail)}
        events={eventPresentation(detail.events ?? [])}
      />
      {canCorrect && (
        <div className="space-y-3 border-t border-line/[0.07] pt-4">
          <div>
            <h4 className="text-[13px] font-semibold text-ink">Fulfillment assignment</h4>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              Only active organizations returned by the operations service can be assigned. Pickup
              requires both a custodian and the receiving storage bank.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Assigned custodian">
              <select
                className={inputClass}
                value={custodianOrganizationId}
                onChange={(event) => setCustodianOrganizationId(event.target.value)}
              >
                <option value="">Choose active custodian</option>
                {organizations
                  .filter((entry) => entry.kind === 'custodian')
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
              </select>
            </Labeled>
            <Labeled
              label="Assigned storage bank"
              hint={detail.method === 'pickup' ? 'Required for pickup' : 'Optional for courier'}
            >
              <select
                className={inputClass}
                value={bankOrganizationId}
                onChange={(event) => setBankOrganizationId(event.target.value)}
              >
                <option value="">
                  {detail.method === 'pickup' ? 'Choose active bank' : 'No bank'}
                </option>
                {organizations
                  .filter((entry) => entry.kind === 'bank')
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
              </select>
            </Labeled>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={
              assignment.isPending ||
              !custodianOrganizationId ||
              (detail.method === 'pickup' && !bankOrganizationId)
            }
            onClick={() => assignment.mutate()}
          >
            {assignment.isPending
              ? 'Saving assignment…'
              : detail.assignment
                ? 'Update assignment'
                : 'Assign fulfillment teams'}
          </Button>
          {organizations.length === 0 && (
            <p role="alert" className="text-[11.5px] text-amber">
              No active custodian or bank choices are available. Assignment remains disabled.
            </p>
          )}
          {assignment.error && (
            <p role="alert" className="text-[12px] text-ruby">
              {assignment.error instanceof Error
                ? assignment.error.message
                : 'Assignment could not be saved.'}
            </p>
          )}
        </div>
      )}
      {detail.capabilities?.includes('approve_fulfillment_proof') && (
        <div className="space-y-3 border-t border-line/[0.07] pt-4">
          <div className="rounded-[4px] border border-line/[0.08] bg-line/[0.02] p-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-dim">
              Proof digest
            </p>
            <p className="mt-1 break-all font-mono text-[11px] text-ink">
              {detail.proofDigest ?? 'Proof digest unavailable'}
            </p>
          </div>
          <p className="text-[11.5px] text-ink-muted">
            Approval permits the server to issue a request-bound owner code. It does not burn the
            token.
          </p>
          {!prepared ? (
            <Button onClick={() => approval.mutate()} disabled={approval.isPending}>
              {approval.isPending ? 'Preparing approval…' : 'Prepare delivery proof approval'}
            </Button>
          ) : !preparedValid ? (
            <p role="alert" className="text-[12px] text-ruby">
              The prepared approval is incomplete. Reload instead of signing it.
            </p>
          ) : (
            <TxButton
              telemetryFlow="redemption_proof_approval"
              action={() =>
                dataService.approveFulfillmentProof({
                  tokenId: BigInt(preparedArgs!.tokenId),
                  approvalId: preparedArgs!.approvalId!,
                  approvalVersion: BigInt(preparedArgs!.approvalVersion!),
                })
              }
              onConfirmed={async ({ hash }) => {
                if (!address) throw new Error('Reconnect the verified proof-approver wallet.');
                await approveRedemptionProof({
                  requestId: workflow.id,
                  organizationId: approvalOrganizationId!,
                  expectedVersion: detail.version,
                  idempotencyKey: prepared.intent,
                  approverWallet: address,
                  transactionHash: hash,
                });
                if (prepared.storageKey) clearOperationIdempotencyKey(prepared.storageKey);
              }}
              doneLabel="Return to tracker"
              onDone={() => {
                setPrepared(undefined);
                void queryClient.invalidateQueries({ queryKey: ['operations'] });
              }}
            >
              Approve proof in wallet
            </TxButton>
          )}
        </div>
      )}
      {detail.capabilities?.includes('reject_fulfillment_proof') && (
        <div className="space-y-3 border-t border-line/[0.07] pt-4">
          <div>
            <h4 className="text-[13px] font-semibold text-ink">Reject submitted proof</h4>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              Rejection is written on-chain, keeps the reason in the audit trail and returns the
              request to the custodian for a new pickup or courier proof.
            </p>
          </div>
          {!preparedRejection ? (
            <>
              <Labeled label="Rejection reason" hint="10–2000 characters; retained internally">
                <textarea
                  className={`${inputClass} min-h-24 py-3`}
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  minLength={10}
                  maxLength={2_000}
                />
              </Labeled>
              <Button
                size="sm"
                variant="danger"
                onClick={() => rejection.mutate()}
                disabled={rejection.isPending || rejectionReason.trim().length < 10}
              >
                {rejection.isPending ? 'Preparing rejection…' : 'Prepare proof rejection'}
              </Button>
            </>
          ) : rejectionValid ? (
            <TxButton
              variant="danger"
              telemetryFlow="redemption_proof_rejection"
              action={() =>
                dataService.rejectFulfillmentProof({
                  tokenId: BigInt(rejectionArgs!.tokenId),
                  reasonHash: rejectionArgs!.reasonHash!,
                })
              }
              onConfirmed={async ({ hash }) => {
                if (!approvalOrganizationId || !address) {
                  throw new Error('Reconnect the verified proof-approver wallet.');
                }
                await rejectRedemptionProof({
                  requestId: workflow.id,
                  organizationId: approvalOrganizationId,
                  expectedVersion: detail.version,
                  idempotencyKey: preparedRejection.intent,
                  approverWallet: address,
                  reason: preparedRejection.reason,
                  transactionHash: hash,
                });
                if (preparedRejection.storageKey) {
                  clearOperationIdempotencyKey(preparedRejection.storageKey);
                }
              }}
              doneLabel="Return to tracker"
              onDone={() => {
                setPreparedRejection(undefined);
                setRejectionReason('');
                void queryClient.invalidateQueries({ queryKey: ['operations'] });
              }}
            >
              Reject proof in wallet
            </TxButton>
          ) : (
            <p role="alert" className="text-[12px] text-ruby">
              The rejection preparation is incomplete. Reload instead of signing it.
            </p>
          )}
          {rejection.error && (
            <p role="alert" className="text-[12px] text-ruby">
              {rejection.error instanceof Error
                ? rejection.error.message
                : 'Proof rejection could not be prepared.'}
            </p>
          )}
        </div>
      )}
      {approval.error && (
        <p role="alert" className="text-[12px] text-ruby">
          {approval.error instanceof Error
            ? approval.error.message
            : 'Proof could not be approved.'}
        </p>
      )}
      {(detail.recovery ||
        detail.capabilities?.some((capability) =>
          ['propose_recovery', 'approve_recovery', 'execute_recovery'].includes(capability),
        )) && (
        <RecoveryPanel
          request={detail}
          organizationId={
            access?.memberships.find((entry) => entry.capabilities.includes('redemption.recover'))
              ?.organizationId
          }
          wallet={address}
        />
      )}
      {canCorrect && (
        <CorrectionForm
          kind="redemption"
          workflowId={detail.id}
          version={detail.version}
          events={detail.events ?? []}
        />
      )}
    </Card>
  );
}

type RecoveryAction = 'propose_recovery' | 'approve_recovery' | 'execute_recovery';

function RecoveryPanel({
  request,
  organizationId,
  wallet,
}: {
  request: RedemptionTracker;
  organizationId?: string;
  wallet?: `0x${string}`;
}) {
  const queryClient = useQueryClient();
  const [evidence, setEvidence] = useState<WorkflowEvidenceView>();
  const [openedAt] = useState(() => Date.now());
  const recovery = request.recovery;
  const action: RecoveryAction = !recovery
    ? 'propose_recovery'
    : recovery.approvals < recovery.requiredApprovals
      ? 'approve_recovery'
      : 'execute_recovery';
  const canAct = request.capabilities?.includes(action) ?? false;
  const graceComplete = Boolean(recovery && Date.parse(recovery.executeAfter) <= openedAt);
  const [prepared, setPrepared] = useState<{
    action: RecoveryAction;
    idempotencyKey: string;
    storageKey?: string;
    expectedVersion: number;
    recoveryWallet: string;
    evidenceId?: string;
    result: RedemptionMutationResult;
  }>();
  const pending = useQuery({
    queryKey: ['operations', 'redemption', request.id, 'pending-action', action],
    queryFn: () =>
      resumeRedemptionActionIntent({
        requestId: request.id,
        intentAction: action,
        organizationId,
      }),
    enabled: Boolean(organizationId && canAct),
  });
  useEffect(() => {
    if (!pending.data || prepared) return;
    const chainAction = {
      propose_recovery: 'proposeRecovery',
      approve_recovery: 'approveRecovery',
      execute_recovery: 'executeRecovery',
    } as const;
    setPrepared({
      action,
      idempotencyKey: pending.data.idempotencyKey,
      expectedVersion: pending.data.expectedVersion,
      recoveryWallet: String(pending.data.payload.recoveryWallet ?? ''),
      evidenceId:
        typeof pending.data.payload.evidenceId === 'string'
          ? pending.data.payload.evidenceId
          : undefined,
      result: {
        request,
        chainAction: chainAction[action],
        args: pending.data.chainArguments,
      },
    });
  }, [action, pending.data, prepared, request]);

  const prepare = useMutation({
    mutationFn: async () => {
      if (!organizationId || !wallet) {
        throw new Error('Connect a verified recovery-admin wallet.');
      }
      if (action === 'propose_recovery' && !evidence) {
        throw new Error('Upload and verify recovery evidence first.');
      }
      const storageKey = `admin:redemption:${request.id}:${action}:${recovery?.proposalHash ?? request.version}`;
      const idempotencyKey = operationIdempotencyKey(storageKey);
      const result = await mutateRedemptionRecovery(action, {
        requestId: request.id,
        organizationId,
        expectedVersion: request.version,
        idempotencyKey,
        recoveryWallet: wallet,
        ...(evidence ? { evidenceId: evidence.id } : {}),
      });
      return {
        action,
        idempotencyKey,
        storageKey,
        expectedVersion: request.version,
        recoveryWallet: wallet,
        evidenceId: evidence?.id,
        result,
      };
    },
    onSuccess: setPrepared,
  });
  const args = prepared?.result.args;
  const preparedValid = Boolean(
    prepared &&
    args?.tokenId &&
    ((prepared.action === 'propose_recovery' &&
      prepared.result.chainAction === 'proposeRecovery' &&
      args.evidenceDigest) ||
      (prepared.action === 'approve_recovery' &&
        prepared.result.chainAction === 'approveRecovery' &&
        args.proposalHash) ||
      (prepared.action === 'execute_recovery' &&
        prepared.result.chainAction === 'executeRecovery' &&
        args.proposalHash)),
  );
  const walletMatches = Boolean(
    wallet && prepared && wallet.toLowerCase() === prepared.recoveryWallet.toLowerCase(),
  );
  async function confirm(hash: `0x${string}`) {
    if (!organizationId || !wallet || !prepared || !walletMatches) {
      throw new Error('Reconnect the recovery-admin wallet that prepared this action.');
    }
    await mutateRedemptionRecovery(prepared.action, {
      requestId: request.id,
      organizationId,
      expectedVersion: prepared.expectedVersion,
      idempotencyKey: prepared.idempotencyKey,
      recoveryWallet: wallet,
      ...(prepared.evidenceId ? { evidenceId: prepared.evidenceId } : {}),
      transactionHash: hash,
    });
    if (prepared.storageKey) clearOperationIdempotencyKey(prepared.storageKey);
  }

  return (
    <div className="space-y-3 border-t border-ruby/20 pt-4">
      <div>
        <h4 className="text-[13px] font-semibold text-ruby">Emergency recovery</h4>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
          Recovery is a delayed last resort. It needs two distinct on-chain admin wallets; the
          proposer counts as the first approval. Proposal identity and timing come only from the
          verified contract event and view.
        </p>
      </div>
      {recovery && (
        <div className="grid gap-2 rounded-[4px] border border-ruby/20 bg-ruby/[0.035] p-3 text-[11px] sm:grid-cols-2">
          <span className="text-ink-muted">
            Approvals{' '}
            <strong className="text-ink">
              {recovery.approvals}/{recovery.requiredApprovals}
            </strong>
          </span>
          <span className="text-ink-muted">
            Grace ends{' '}
            <strong className="text-ink">{new Date(recovery.executeAfter).toLocaleString()}</strong>
          </span>
          <span className="break-all font-mono text-ink-dim sm:col-span-2">
            Proposal {recovery.proposalHash}
          </span>
        </div>
      )}
      {canAct && action === 'propose_recovery' && !prepared && (
        <EvidenceUpload
          requestId={request.id}
          organizationId={organizationId}
          category="recovery_evidence"
          label="Recovery evidence"
          onUploaded={setEvidence}
        />
      )}
      {canAct && action === 'execute_recovery' && !graceComplete && (
        <p className="text-[11.5px] text-amber">
          Both approvals are recorded. Execution remains locked until the seven-day grace period
          ends.
        </p>
      )}
      {canAct && !prepared && (action !== 'execute_recovery' || graceComplete) && (
        <Button
          size="sm"
          variant={action === 'execute_recovery' ? 'danger' : 'secondary'}
          disabled={prepare.isPending || (action === 'propose_recovery' && !evidence)}
          onClick={() => prepare.mutate()}
        >
          {prepare.isPending
            ? 'Preparing recovery…'
            : action === 'propose_recovery'
              ? 'Prepare recovery proposal'
              : action === 'approve_recovery'
                ? 'Prepare second-wallet approval'
                : 'Prepare recovery execution'}
        </Button>
      )}
      {prepared && !walletMatches && (
        <p role="alert" className="text-[12px] text-amber">
          Connect the recovery wallet that prepared this action: {prepared.recoveryWallet}
        </p>
      )}
      {prepared && preparedValid && walletMatches && (
        <TxButton
          variant={prepared.action === 'execute_recovery' ? 'danger' : 'primary'}
          telemetryFlow={`redemption_${prepared.action}`}
          action={() => {
            if (prepared.action === 'propose_recovery') {
              return dataService.proposeRedemptionRecovery({
                tokenId: BigInt(args!.tokenId),
                evidenceDigest: args!.evidenceDigest!,
              });
            }
            if (prepared.action === 'approve_recovery') {
              return dataService.approveRedemptionRecovery({
                tokenId: BigInt(args!.tokenId),
                proposalHash: args!.proposalHash!,
              });
            }
            return dataService.executeRedemptionRecovery({
              tokenId: BigInt(args!.tokenId),
              proposalHash: args!.proposalHash!,
            });
          }}
          onConfirmed={({ hash }) => confirm(hash)}
          doneLabel="Return to tracker"
          onDone={() => {
            setPrepared(undefined);
            setEvidence(undefined);
            void queryClient.invalidateQueries({ queryKey: ['operations'] });
          }}
        >
          {prepared.action === 'propose_recovery'
            ? 'Propose recovery in wallet'
            : prepared.action === 'approve_recovery'
              ? 'Approve with this distinct wallet'
              : 'Execute delayed recovery'}
        </TxButton>
      )}
      {prepared && !preparedValid && (
        <p role="alert" className="text-[12px] text-ruby">
          The server preparation is incomplete. Reload instead of signing it.
        </p>
      )}
      {prepare.error && (
        <p role="alert" className="text-[12px] text-ruby">
          {prepare.error instanceof Error
            ? prepare.error.message
            : 'Recovery could not be prepared.'}
        </p>
      )}
    </div>
  );
}

function CorrectionForm({
  kind,
  workflowId,
  version,
  events,
}: {
  kind: WorkflowKind;
  workflowId: string;
  version: number;
  events: SellerWorkflowView['events'];
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [supersedesEventId, setSupersedesEventId] = useState('');
  const [toState, setToState] = useState('');
  const [reason, setReason] = useState('');
  const [payload, setPayload] = useState('{}');
  const mutation = useMutation({
    mutationFn: async (event: FormEvent) => {
      event.preventDefault();
      const intent = `admin:${kind}:${workflowId}:correct:${supersedesEventId}`;
      const response = await correctWorkflow({
        workflowKind: kind,
        workflowId,
        expectedVersion: version,
        supersedesEventId,
        toState: toState.trim(),
        reason: reason.trim(),
        payload: JSON.parse(payload) as Record<string, unknown>,
        idempotencyKey: operationIdempotencyKey(intent),
      });
      clearOperationIdempotencyKey(intent);
      return response;
    },
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['operations', 'admin'] });
    },
  });
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Append correction
      </Button>
    );
  }
  return (
    <form
      onSubmit={(event) => mutation.mutate(event)}
      className="space-y-3 rounded-[4px] border border-amber/25 bg-amber/[0.035] p-4"
    >
      <p className="text-[12px] leading-relaxed text-amber">
        Corrections never edit history. This appends a new event that visibly supersedes the
        selected record.
      </p>
      <Labeled label="Event to supersede">
        <select
          className={inputClass}
          value={supersedesEventId}
          onChange={(event) => setSupersedesEventId(event.target.value)}
          required
        >
          <option value="">Choose event</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              #{event.sequence} {event.type.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </Labeled>
      <Field
        label="Corrected workflow state"
        value={toState}
        onChange={(event) => setToState(event.target.value)}
        required
      />
      <Labeled label="Correction reason" hint="Minimum 10 characters">
        <textarea
          className={`${inputClass} min-h-24 py-3`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={10}
          required
        />
      </Labeled>
      <Labeled label="Correction payload JSON">
        <textarea
          className={`${inputClass} min-h-24 py-3 font-mono text-[11px]`}
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          required
        />
      </Labeled>
      {mutation.error && (
        <p role="alert" className="text-[12px] text-ruby">
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Correction could not be appended.'}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={
            mutation.isPending || !supersedesEventId || reason.trim().length < 10 || !toState.trim()
          }
        >
          {mutation.isPending ? 'Appending…' : 'Append correction'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function MatrixActivation({ canActivate }: { canActivate: boolean }) {
  const queryClient = useQueryClient();
  const matrices = useQuery({
    queryKey: ['operations', 'matrices'],
    queryFn: loadAppraisalMatrices,
  });
  const active = useMemo(
    () => matrices.data?.find((matrix) => matrix.state === 'active'),
    [matrices.data],
  );
  const mutation = useMutation({
    mutationFn: (matrixId: string) => activateMatrix(matrixId, active?.version ?? ''),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operations', 'matrices'] }),
  });
  if (matrices.isLoading) return <Skeleton className="h-64" />;
  if (matrices.isError) {
    return (
      <ErrorState message={matrices.error instanceof Error ? matrices.error.message : undefined} />
    );
  }
  return (
    <Card className="p-0">
      <div className="border-b border-line/[0.07] px-4 py-3">
        <h3 className="text-[13px] font-semibold text-ink">Matrix approval history</h3>
        <p className="mt-1 text-[11.5px] text-ink-muted">
          Only a proposed version can replace the current active matrix.
        </p>
      </div>
      {(matrices.data ?? []).length === 0 ? (
        <p className="px-4 py-8 text-[12px] text-ink-dim">No matrix versions exist.</p>
      ) : (
        <ul className="divide-y divide-line/[0.06]">
          {matrices.data!.map((matrix) => (
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
                {canActivate && matrix.state === 'proposed' && matrix.id && (
                  <Button
                    size="sm"
                    onClick={() => mutation.mutate(matrix.id!)}
                    disabled={mutation.isPending || !active}
                  >
                    Activate
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {mutation.error && (
        <p role="alert" className="m-3 text-[12px] text-ruby">
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Matrix could not be activated.'}
        </p>
      )}
    </Card>
  );
}

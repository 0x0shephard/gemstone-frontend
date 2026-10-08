import { useEffect, useState } from 'react';
import { useProfile, useRedemptions, useRedemptionWorkflows } from '@/hooks/useData';
import { redemptionReserveEligible } from '@/lib/gem';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { GemThumb } from '@/components/gem/GemThumb';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/States';
import { GemActionModals } from '@/components/modals/GemActionModals';
import { useGemModals } from '@/hooks/useGemModals';
import { cn } from '@/lib/cn';
import { useAuth } from '@/providers/AuthProvider';
import { RedemptionReceipts } from '@/components/redemption/RedemptionReceipt';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  authorizeRedemptionOwner,
  clearOperationIdempotencyKey,
  discardRedemption,
  loadOwnerRedemptionTrackers,
  loadRedemptionTracker,
  markRedemptionChainBurned,
  nominateRedemptionProxy,
  operationIdempotencyKey,
  prepareOwnerAuthorization,
  prepareProxyNomination,
  prepareRedemptionCancellation,
  resumeRedemptionActionIntent,
  resendRedemptionOwnerCode,
  type RedemptionAuthorization,
  type RedemptionMutationResult,
  type RedemptionTracker,
  type WorkflowEvidenceView,
} from '@/services/offchain/operations';
import { LifecycleTracker } from '@/components/operations/LifecycleTracker';
import {
  eventPresentation,
  redemptionLifecycleStages,
} from '@/components/operations/lifecyclePresentation';
import { EvidenceUpload } from '@/components/operations/EvidenceUpload';
import { Field } from '@/components/ui/Field';
import { TxButton } from '@/components/tx/TxButton';
import { dataService } from '@/services';
import { useAccount, useSignMessage } from 'wagmi';
import { isAddress, isAddressEqual } from 'viem';
import { assertActiveDeploymentRelease } from '@/services/chain/deploymentReleaseGuard';

/** The six redemption steps, in the order the tracker below records them. */
const STEPS = [
  {
    n: '01',
    title: 'On-chain request',
    body: 'You open the request from your wallet and the token locks. Digital Carat accepts it.',
  },
  {
    n: '02',
    title: 'Bank confirms',
    body: 'The bank storing your stone confirms it holds it and prepares its release.',
  },
  {
    n: '03',
    title: 'Bank dispatches',
    body: 'The bank dispatches your stone to the custodian who delivers it.',
  },
  {
    n: '04',
    title: 'Custodian delivers',
    body: 'The custodian delivers it to the pickup point or your address, and you are emailed a one-time code.',
  },
  {
    n: '05',
    title: 'Handed to you',
    body: 'When you receive the stone, enter the code in this portal to confirm the handover.',
  },
  {
    n: '06',
    title: 'Token burned',
    body: 'You burn the token from your wallet and the reserve is credited to you.',
    danger: true,
  },
];

/** What each tracker state means to the holder, in place of the internal state name. */
const STATUS_LABEL: Record<string, string> = {
  draft: 'Not submitted',
  committed: 'Awaiting wallet transaction',
  onchain_requested: 'Awaiting Digital Carat acceptance',
  accepted: 'Accepted · with the storage bank',
  custodian_collected: 'Bank preparing your stone',
  custodian_dispatched: 'On its way',
  bank_received: 'On its way',
  pickup_handover_recorded: 'Arrived',
  arrived: 'Arrived · code on its way',
  pickup_proof_submitted: 'Arrived · code on its way',
  delivery_proof_submitted: 'Arrived · code on its way',
  proof_approved: 'Arrived · confirm with your code',
  owner_authorized: 'Confirmed · burn the token',
  chain_burned: 'Redeemed',
  cancelled: 'Cancelled',
};

export default function RedeemPage() {
  const { user } = useAuth();
  const { data: profile, isLoading } = useProfile();
  const { data: redemptions } = useRedemptions();
  const {
    data: redemptionWorkflows = [],
    isLoading: workflowsLoading,
    isError: workflowsError,
    refetch: refetchWorkflows,
  } = useRedemptionWorkflows(user?.id);
  const modals = useGemModals();
  const lifecycleQuery = useQuery({
    queryKey: ['operations', 'redemption', 'owner', user?.id],
    queryFn: loadOwnerRedemptionTrackers,
    enabled: Boolean(user),
    placeholderData: (previous) => previous,
  });

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
            Your token stays locked while the bank releases the stone and the custodian delivers it,
            and is burned only after you confirm the handover with your code.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

      {user && lifecycleQuery.isLoading && !lifecycleQuery.data && <Skeleton className="h-72" />}
      {user && lifecycleQuery.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-amber/25 bg-amber/[0.06] px-4 py-3 text-[12px] text-amber"
        >
          <span>
            {lifecycleQuery.data?.length
              ? 'Tracker refresh failed. Showing the last verified state.'
              : 'Your redemption tracker could not be loaded.'}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void lifecycleQuery.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {user && (lifecycleQuery.data?.length ?? 0) > 0 && (
        <section className="space-y-3" aria-labelledby="redemption-tracker-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="redemption-tracker-heading" className="text-[16px] font-semibold text-ink">
                Redemption tracker
              </h3>
              <p className="mt-1 text-[12px] text-ink-muted">
                Reload-safe status from the same lifecycle used by the custodian, bank and admin.
              </p>
            </div>
            {lifecycleQuery.isFetching && <StatusBadge tone="neutral">Refreshing</StatusBadge>}
          </div>
          {lifecycleQuery.data!.map((workflow) => (
            <OwnerRedemptionCard key={workflow.id} summary={workflow} />
          ))}
        </section>
      )}

      {user && workflowsLoading && <Skeleton className="h-32" />}
      {user && workflowsError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-amber/25 bg-amber/[0.06] px-4 py-3 text-[12px] text-amber"
        >
          <span>Your saved redemption receipts could not be loaded.</span>
          <Button size="sm" variant="ghost" onClick={() => void refetchWorkflows()}>
            Retry
          </Button>
        </div>
      )}
      {user && (
        <RedemptionReceipts workflows={redemptionWorkflows} redemptions={redemptions ?? []} />
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
                const canRedeem = redemptionReserveEligible(gem) && gem.redeem === 'Eligible';
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

export function OwnerRedemptionCard({ summary }: { summary: RedemptionTracker }) {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [proxyName, setProxyName] = useState('');
  const [proxyWallet, setProxyWallet] = useState('');
  const [identityEvidence, setIdentityEvidence] = useState<WorkflowEvidenceView>();
  const [preparedProxy, setPreparedProxy] = useState<{
    intent: string;
    result: RedemptionMutationResult;
    signature: `0x${string}`;
    collectorCommitment: `0x${string}`;
  }>();
  const [code, setCode] = useState('');
  const [mountedAt] = useState(() => Date.now());
  const [preparedCancellation, setPreparedCancellation] = useState<{
    idempotencyKey: string;
    storageKey: string;
    result: RedemptionMutationResult;
  }>();
  const [authorization, setAuthorization] = useState<{
    intent: string;
    value: RedemptionAuthorization;
    version: number;
  }>();
  const detailQuery = useQuery({
    queryKey: ['operations', 'redemption', 'detail', summary.id, 'owner'],
    queryFn: () => loadRedemptionTracker(summary.id),
    placeholderData: summary,
  });
  const request = detailQuery.data ?? summary;
  const capabilities = new Set(request.capabilities ?? []);
  const persistedAuthorizationIsCurrent =
    request.authorization && Number(request.authorization.deadline) * 1_000 > mountedAt;
  const finalAuthorization =
    authorization ??
    (request.authorization && persistedAuthorizationIsCurrent
      ? {
          intent: `redemption:${request.id}:authorized:${request.authorization.nonce}`,
          value: request.authorization,
          version: request.version,
        }
      : undefined);

  const ensureOwnerWallet = () => {
    if (!address || !request.ownerWallet || !isAddress(request.ownerWallet)) {
      throw new Error('Connect the owner wallet recorded for this redemption.');
    }
    if (!isAddressEqual(address, request.ownerWallet)) {
      throw new Error('The connected wallet is not the owner wallet for this redemption.');
    }
    return address;
  };
  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: ['operations', 'redemption'] });
  };

  const proxyMutation = useMutation({
    mutationFn: async () => {
      ensureOwnerWallet();
      if (!identityEvidence) throw new Error('Upload proxy identity evidence first.');
      if (!proxyName.trim() || !isAddress(proxyWallet)) {
        throw new Error('Enter the named proxy and a valid proxy wallet.');
      }
      await assertActiveDeploymentRelease();
      const prepared = await prepareProxyNomination({
        requestId: request.id,
        proxyName: proxyName.trim(),
        proxyWallet,
        identityEvidenceId: identityEvidence.id,
      });
      const signature = await signMessageAsync({ message: prepared.nomination.message });
      const intent = `redemption:${request.id}:proxy:${prepared.nomination.collectorCommitment}`;
      const result = await nominateRedemptionProxy({
        requestId: request.id,
        expectedVersion: request.version,
        idempotencyKey: operationIdempotencyKey(intent),
        proxyName: proxyName.trim(),
        proxyWallet,
        identityEvidenceId: identityEvidence.id,
        collectorCommitment: prepared.nomination.collectorCommitment,
        ownerSignature: signature,
      });
      return {
        intent,
        result,
        signature,
        collectorCommitment: prepared.nomination.collectorCommitment,
      };
    },
    onSuccess: setPreparedProxy,
  });

  const authorizationMutation = useMutation({
    mutationFn: async () => {
      const ownerWallet = ensureOwnerWallet();
      if (!code.trim()) throw new Error('Enter the request-bound code from your email.');
      await assertActiveDeploymentRelease();
      const challengeIntent = `redemption:${request.id}:prepare-owner-authorization:${request.version}`;
      const prepared = await prepareOwnerAuthorization({
        requestId: request.id,
        code: code.trim(),
        ownerWallet,
        expectedVersion: request.version,
        idempotencyKey: operationIdempotencyKey(challengeIntent),
      });
      clearOperationIdempotencyKey(challengeIntent);
      const ownerSignature = await signMessageAsync({ message: prepared.challenge.message });
      const intent = `redemption:${request.id}:authorize:${prepared.challenge.id}`;
      const result = await authorizeRedemptionOwner({
        requestId: request.id,
        challengeId: prepared.challenge.id,
        code: code.trim(),
        ownerWallet,
        ownerSignature,
        expectedVersion: request.version,
        idempotencyKey: operationIdempotencyKey(intent),
      });
      return { intent, value: result.authorization, version: result.request.version };
    },
    onSuccess: setAuthorization,
  });

  const resendMutation = useMutation({
    mutationFn: async () => {
      const intent = `redemption:${request.id}:resend-owner-code:${request.version}`;
      const result = await resendRedemptionOwnerCode({
        requestId: request.id,
        expectedVersion: request.version,
        idempotencyKey: operationIdempotencyKey(intent),
      });
      clearOperationIdempotencyKey(intent);
      return result;
    },
    onSuccess: reload,
  });
  const cancellationMutation = useMutation({
    mutationFn: async () => {
      const storageKey = `redemption:${request.id}:cancel`;
      const idempotencyKey = operationIdempotencyKey(storageKey);
      const result = await prepareRedemptionCancellation({
        requestId: request.id,
        expectedVersion: request.version,
        idempotencyKey,
      });
      return { storageKey, idempotencyKey, result };
    },
    onSuccess: setPreparedCancellation,
  });
  const discardMutation = useMutation({
    mutationFn: async () => {
      const storageKey = `redemption:${request.id}:discard`;
      const result = await discardRedemption({
        requestId: request.id,
        expectedVersion: request.version,
        idempotencyKey: operationIdempotencyKey(storageKey),
      });
      clearOperationIdempotencyKey(storageKey);
      return result;
    },
    onSuccess: reload,
  });
  const pendingCancellation = useQuery({
    queryKey: ['operations', 'redemption', request.id, 'pending-action', 'cancel'],
    queryFn: () =>
      resumeRedemptionActionIntent({
        requestId: request.id,
        intentAction: 'cancel_redemption',
      }),
    enabled: capabilities.has('cancel_redemption'),
  });
  useEffect(() => {
    if (!pendingCancellation.data || preparedCancellation) return;
    setPreparedCancellation({
      idempotencyKey: pendingCancellation.data.idempotencyKey,
      storageKey: `redemption:${request.id}:cancel`,
      result: {
        request,
        chainAction: 'cancelRedemption',
        args: pendingCancellation.data.chainArguments,
      },
    });
  }, [pendingCancellation.data, preparedCancellation, request]);

  const proxyArgs = preparedProxy?.result.args;
  const proxyPreparedValid =
    preparedProxy?.result.chainAction === 'setCollectorCommitment' &&
    proxyArgs?.tokenId &&
    proxyArgs.collectorCommitment === preparedProxy.collectorCommitment;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-[14px] font-semibold text-ink">
            {request.gem?.name ?? `Token #${request.tokenId}`}
          </h4>
          <p className="mt-1 font-mono text-[10.5px] text-ink-dim">Request {request.id}</p>
        </div>
        <StatusBadge
          tone={
            request.status === 'chain_burned'
              ? 'success'
              : request.status === 'cancelled'
                ? 'neutral'
                : 'info'
          }
        >
          {STATUS_LABEL[request.status] ?? request.status.replaceAll('_', ' ')}
        </StatusBadge>
      </div>
      <LifecycleTracker
        title="Physical fulfillment"
        stages={redemptionLifecycleStages(request)}
        events={eventPresentation(request.events ?? [])}
      />

      {request.recovery && (
        <div className="space-y-2 rounded-[4px] border border-ruby/20 bg-ruby/[0.035] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h5 className="text-[12px] font-semibold text-ruby">Emergency recovery in progress</h5>
            <StatusBadge tone={request.recovery.state === 'executed' ? 'success' : 'warning'}>
              {request.recovery.state}
            </StatusBadge>
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
            Recovery is controlled by independently verified admin wallets. It cannot execute until
            two distinct approvals and the seven-day grace period are both complete.
          </p>
          <dl className="grid gap-1 text-[11px] sm:grid-cols-2">
            <div>
              <dt className="text-ink-dim">Approvals</dt>
              <dd className="text-ink">
                {request.recovery.approvals}/{request.recovery.requiredApprovals}
              </dd>
            </div>
            <div>
              <dt className="text-ink-dim">Grace ends</dt>
              <dd className="text-ink">
                {new Date(request.recovery.executeAfter).toLocaleString()}
              </dd>
            </div>
          </dl>
          <p className="break-all font-mono text-[10px] text-ink-dim">
            Proposal {request.recovery.proposalHash}
          </p>
        </div>
      )}

      {detailQuery.isError && (
        <p role="alert" className="text-[12px] text-amber">
          Current owner actions could not be loaded. The last verified tracker remains visible.
        </p>
      )}

      {capabilities.has('discard_redemption') && (
        <div className="space-y-3 border-t border-line/[0.07] pt-4">
          <div>
            <h5 className="text-[13px] font-semibold text-ink">Discard this request</h5>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              This request never opened on-chain, so your token is not locked. Discard it if you no
              longer want to redeem, or start again from your holdings.
            </p>
          </div>
          <Button
            size="sm"
            variant="danger"
            onClick={() => discardMutation.mutate()}
            disabled={discardMutation.isPending}
          >
            {discardMutation.isPending ? 'Discarding…' : 'Discard request'}
          </Button>
          {discardMutation.error && (
            <p role="alert" className="text-[12px] text-ruby">
              {discardMutation.error instanceof Error
                ? discardMutation.error.message
                : 'The request could not be discarded.'}
            </p>
          )}
        </div>
      )}

      {capabilities.has('cancel_redemption') && (
        <div className="space-y-3 border-t border-line/[0.07] pt-4">
          <div>
            <h5 className="text-[13px] font-semibold text-ink">Cancel redemption</h5>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              Cancelling unlocks your token and closes this request. It is available until the bank
              confirms it holds the stone.
            </p>
          </div>
          {!preparedCancellation ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => cancellationMutation.mutate()}
              disabled={cancellationMutation.isPending}
            >
              {cancellationMutation.isPending ? 'Preparing…' : 'Prepare cancellation'}
            </Button>
          ) : preparedCancellation.result.chainAction === 'cancelRedemption' &&
            preparedCancellation.result.args?.tokenId ? (
            <TxButton
              variant="danger"
              telemetryFlow="redemption_cancel"
              action={() =>
                dataService.cancelRedemption({
                  tokenId: BigInt(preparedCancellation.result.args!.tokenId),
                })
              }
              onConfirmed={async ({ hash }) => {
                await prepareRedemptionCancellation({
                  requestId: request.id,
                  expectedVersion: request.version,
                  idempotencyKey: preparedCancellation.idempotencyKey,
                  transactionHash: hash,
                });
                clearOperationIdempotencyKey(preparedCancellation.storageKey);
              }}
              doneLabel="Return to tracker"
              onDone={() => {
                setPreparedCancellation(undefined);
                void reload();
              }}
            >
              Cancel redemption in wallet
            </TxButton>
          ) : (
            <p role="alert" className="text-[12px] text-ruby">
              The cancellation preparation is incomplete. Reload instead of signing it.
            </p>
          )}
          {cancellationMutation.error && (
            <p role="alert" className="text-[12px] text-ruby">
              {cancellationMutation.error instanceof Error
                ? cancellationMutation.error.message
                : 'Cancellation could not be prepared.'}
            </p>
          )}
        </div>
      )}

      {capabilities.has('prepare_proxy_nomination') && !preparedProxy && (
        <div className="space-y-3 border-t border-line/[0.07] pt-4">
          <div>
            <h5 className="text-[13px] font-semibold text-ink">Nominate a pickup proxy</h5>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              The owner signs the exact request-bound nomination. Identity evidence stays private;
              only its commitment is written on-chain. A proxy can collect but can never burn the
              owner&apos;s token.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Proxy legal name"
              value={proxyName}
              onChange={(e) => setProxyName(e.target.value)}
            />
            <Field
              label="Proxy wallet"
              value={proxyWallet}
              onChange={(e) => setProxyWallet(e.target.value)}
              placeholder="0x…"
            />
          </div>
          <EvidenceUpload
            requestId={request.id}
            category="proxy_identity"
            label="Proxy identity evidence"
            onUploaded={setIdentityEvidence}
          />
          {proxyMutation.error && (
            <p role="alert" className="text-[12px] text-ruby">
              {proxyMutation.error instanceof Error
                ? proxyMutation.error.message
                : 'Proxy nomination could not be prepared.'}
            </p>
          )}
          <Button
            size="sm"
            onClick={() => proxyMutation.mutate()}
            disabled={
              proxyMutation.isPending ||
              !identityEvidence ||
              !proxyName.trim() ||
              !isAddress(proxyWallet)
            }
          >
            {proxyMutation.isPending ? 'Preparing nomination…' : 'Sign proxy nomination'}
          </Button>
        </div>
      )}

      {preparedProxy && (
        <div className="space-y-3 border-t border-line/[0.07] pt-4">
          <p className="text-[12px] text-ink-muted">
            Your nomination signature was verified. The proxy is not nominated until the commitment
            transaction confirms and the lifecycle service records its hash.
          </p>
          {proxyPreparedValid ? (
            <TxButton
              telemetryFlow="redemption_proxy_nomination"
              action={() =>
                dataService.setCollectorCommitment({
                  tokenId: BigInt(proxyArgs.tokenId),
                  collectorCommitment: proxyArgs.collectorCommitment!,
                })
              }
              onConfirmed={async ({ hash }) => {
                await nominateRedemptionProxy({
                  requestId: request.id,
                  expectedVersion: request.version,
                  idempotencyKey: operationIdempotencyKey(preparedProxy.intent),
                  proxyName: proxyName.trim(),
                  proxyWallet,
                  identityEvidenceId: identityEvidence!.id,
                  collectorCommitment: preparedProxy.collectorCommitment,
                  ownerSignature: preparedProxy.signature,
                  transactionHash: hash,
                });
                clearOperationIdempotencyKey(preparedProxy.intent);
              }}
              doneLabel="Return to tracker"
              onDone={() => {
                setPreparedProxy(undefined);
                void reload();
              }}
            >
              Confirm proxy commitment
            </TxButton>
          ) : (
            <p role="alert" className="text-[12px] text-ruby">
              The server preparation is incomplete. Reload instead of signing it.
            </p>
          )}
        </div>
      )}

      {capabilities.has('authorize_owner') && !finalAuthorization && (
        <div className="space-y-3 border-t border-line/[0.07] pt-4">
          <div>
            <h5 className="text-[13px] font-semibold text-ink">Confirm you received the stone</h5>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              Enter the code we emailed when your stone arrived, once it is in your hands. Never
              share it with the bank or custodian. You will sign a short challenge, then burn the
              token from your wallet.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field
              label="Handover code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={() => authorizationMutation.mutate()}
              disabled={authorizationMutation.isPending || !code.trim()}
            >
              {authorizationMutation.isPending ? 'Verifying…' : 'Confirm handover'}
            </Button>
            {capabilities.has('resend_owner_code') && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => resendMutation.mutate()}
                disabled={resendMutation.isPending}
              >
                Resend code
              </Button>
            )}
          </div>
          {(authorizationMutation.error || resendMutation.error) && (
            <p role="alert" className="text-[12px] text-ruby">
              {authorizationMutation.error instanceof Error
                ? authorizationMutation.error.message
                : resendMutation.error instanceof Error
                  ? resendMutation.error.message
                  : 'Owner authorization could not be completed.'}
            </p>
          )}
        </div>
      )}

      {finalAuthorization && (
        <div className="space-y-3 border-t border-ruby/20 pt-4">
          <div className="rounded-[4px] border border-ruby/25 bg-ruby/[0.055] p-3">
            <h5 className="text-[13px] font-semibold text-ruby">Final irreversible action</h5>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              This authorization is bound to request {request.id}. Only the current owner wallet can
              finalize it. Confirmation burns token #{request.tokenId} permanently.
            </p>
          </div>
          <TxButton
            variant="danger"
            telemetryFlow="redemption_owner_finalize"
            action={() =>
              dataService.finalizeRedemption({
                tokenId: BigInt(finalAuthorization.value.tokenId),
                nonce: finalAuthorization.value.nonce,
                issuedAt: BigInt(finalAuthorization.value.issuedAt),
                deadline: BigInt(finalAuthorization.value.deadline),
                authorizer: finalAuthorization.value.authorizer as `0x${string}`,
                signature: finalAuthorization.value.signature,
              })
            }
            onConfirmed={async ({ hash }) => {
              await markRedemptionChainBurned({
                requestId: request.id,
                expectedVersion: finalAuthorization.version,
                idempotencyKey: operationIdempotencyKey(
                  `redemption:${request.id}:chain-burned:${finalAuthorization.value.nonce}`,
                ),
                transactionHash: hash,
              });
              clearOperationIdempotencyKey(finalAuthorization.intent);
            }}
            doneLabel="View receipt"
            onDone={() => {
              setAuthorization(undefined);
              setCode('');
              void reload();
            }}
          >
            Burn token and complete redemption
          </TxButton>
        </div>
      )}

      {capabilities.size === 0 && detailQuery.isSuccess && request.status !== 'chain_burned' && (
        <p className="border-t border-line/[0.07] pt-4 text-[11.5px] text-ink-muted">
          No owner action is currently required. This tracker updates after each verified custody
          event.
        </p>
      )}
    </Card>
  );
}

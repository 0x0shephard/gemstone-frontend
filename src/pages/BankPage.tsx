import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { OperationsAccessGate } from '@/components/operations/OperationsAccessGate';
import { EvidenceUpload } from '@/components/operations/EvidenceUpload';
import { LifecycleTracker } from '@/components/operations/LifecycleTracker';
import {
  eventPresentation,
  redemptionLifecycleStages,
} from '@/components/operations/lifecyclePresentation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Labeled, inputClass } from '@/components/ui/Field';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import {
  clearOperationIdempotencyKey,
  loadBankRedemptionQueue,
  loadBankSellerQueue,
  loadRedemptionTracker,
  operationIdempotencyKey,
  recordBankReceipt,
  recordBankRedemptionReceipt,
  recordPickupHandover,
  type BankSellerQueueItem,
  type RedemptionTracker,
  type WorkflowEvidenceView,
} from '@/services/offchain/operations';
import { useOperationsAccess } from '@/hooks/useOperationsAccess';
import { recordCustodyTerm } from '@/services/offchain/verification';

type BankTab = 'seller' | 'redemption';

export default function BankPage() {
  return (
    <OperationsAccessGate capability="bank.receive">
      <BankWorkspace />
    </OperationsAccessGate>
  );
}

function BankWorkspace() {
  const [tab, setTab] = useState<BankTab>('seller');
  const { data: access } = useOperationsAccess();
  const organizationId = access?.memberships.find((entry) =>
    entry.capabilities.includes('bank.receive'),
  )?.organizationId;
  const sellerQuery = useQuery({
    queryKey: ['operations', 'bank', 'seller'],
    queryFn: loadBankSellerQueue,
    placeholderData: (previous) => previous,
  });
  const redemptionQuery = useQuery({
    queryKey: ['operations', 'bank', 'redemption'],
    queryFn: () => loadBankRedemptionQueue(organizationId),
    enabled: Boolean(organizationId),
    placeholderData: (previous) => previous,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[24px] font-medium tracking-[-0.03em] text-ink">
            Physical storage desk
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            Record only observed arrivals, assigned vault locations and custody dates. Listing and
            redemption cannot advance from an inferred receipt.
          </p>
        </div>
        <StatusBadge tone="neutral" dot>
          {sellerQuery.isFetching || redemptionQuery.isFetching
            ? 'Refreshing'
            : 'Authoritative receipts'}
        </StatusBadge>
      </header>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'seller', label: 'Seller intake', count: sellerQuery.data?.length },
          { key: 'redemption', label: 'Redemption arrivals', count: redemptionQuery.data?.length },
        ]}
      />
      {tab === 'seller' ? (
        <div className="space-y-5">
          <SellerIntakeQueue query={sellerQuery} />
          <LegacyCustodyTerm />
        </div>
      ) : (
        <RedemptionArrivalQueue query={redemptionQuery} organizationId={organizationId!} />
      )}
    </div>
  );
}

function LegacyCustodyTerm() {
  const [gemId, setGemId] = useState('');
  const [escrowEnds, setEscrowEnds] = useState('');
  const [note, setNote] = useState('');
  const [attested, setAttested] = useState(false);
  const [message, setMessage] = useState<string>();
  const [earliestEscrowEnd] = useState(() =>
    new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  );
  const ready = /^\d+$/.test(gemId.trim()) && escrowEnds && note.trim().length >= 10 && attested;
  const mutation = useMutation({
    mutationFn: () =>
      recordCustodyTerm({
        gemId: gemId.trim(),
        reserveEscrowEndsAt: new Date(`${escrowEnds}T00:00:00.000Z`).toISOString(),
        attestationNote: note.trim(),
      }),
    onSuccess: (result) => {
      setMessage(`Custody term recorded for gem ${result.gemId}.`);
      setGemId('');
      setEscrowEnds('');
      setNote('');
      setAttested(false);
    },
  });
  return (
    <Card className="space-y-3 p-5">
      <div>
        <h3 className="text-[13px] font-semibold text-ink">Missing legacy custody terms</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
          Use this only for an already-tokenized gemstone whose original intake record is missing.
          Record the actual custody agreement date shown in the source document. It cannot be
          changed later, and Digital Carat will never calculate or guess it.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="On-chain gemstone ID"
          inputMode="numeric"
          value={gemId}
          onChange={(event) => setGemId(event.target.value.replace(/\D/g, ''))}
        />
        <Labeled label="Reserve escrow ends">
          <input
            type="date"
            className={inputClass}
            min={earliestEscrowEnd}
            value={escrowEnds}
            onChange={(event) => setEscrowEnds(event.target.value)}
          />
        </Labeled>
      </div>
      <Labeled
        label="Agreement reference"
        hint="Required audit note. Do not include a home address or other delivery details."
      >
        <textarea
          className={`${inputClass} min-h-[68px] py-3`}
          maxLength={2_000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Labeled>
      <label className="flex items-start gap-2.5 text-[12.5px] text-ink-soft">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={attested}
          onChange={(event) => setAttested(event.target.checked)}
        />
        <span>I confirm this is the actual custody agreement end date, not an estimate.</span>
      </label>
      {mutation.error && (
        <p role="alert" className="text-[12px] text-ruby">
          {mutation.error instanceof Error ? mutation.error.message : 'Term could not be recorded.'}
        </p>
      )}
      {message && (
        <p role="status" className="text-[12px] text-emerald">
          {message}
        </p>
      )}
      <Button size="sm" disabled={mutation.isPending || !ready} onClick={() => mutation.mutate()}>
        {mutation.isPending ? 'Recording…' : 'Record one-time term'}
      </Button>
    </Card>
  );
}

function SellerIntakeQueue({ query }: { query: UseQueryResult<BankSellerQueueItem[], Error> }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<BankSellerQueueItem>();
  const [location, setLocation] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [custodyStartedAt, setCustodyStartedAt] = useState('');
  const [conditionNotes, setConditionNotes] = useState('');
  const [reserveEscrowEndsAt, setReserveEscrowEndsAt] = useState('');
  const [matchesDeclared, setMatchesDeclared] = useState(true);
  const [confirmed, setConfirmed] = useState<string>();

  const mutation = useMutation({
    mutationFn: async (event: FormEvent) => {
      event.preventDefault();
      if (!selected) throw new Error('Select a submission first.');
      const intent = `bank:${selected.submissionId}:receipt`;
      const response = await recordBankReceipt({
        submissionId: selected.submissionId,
        expectedVersion: selected.version,
        location: location.trim(),
        receivedAt: new Date(receivedAt).toISOString(),
        custodyStartedAt: new Date(custodyStartedAt).toISOString(),
        conditionNotes: conditionNotes.trim(),
        matchesDeclared,
        reserveEscrowEndsAt: new Date(reserveEscrowEndsAt).toISOString(),
        idempotencyKey: operationIdempotencyKey(intent),
      });
      clearOperationIdempotencyKey(intent);
      return response;
    },
    onSuccess: async () => {
      setConfirmed(
        'Bank receipt recorded. The admin activation gate can now re-read this workflow.',
      );
      setSelected(undefined);
      await queryClient.invalidateQueries({ queryKey: ['operations', 'bank', 'seller'] });
    },
  });

  if (query.isLoading && !query.data) return <Skeleton className="h-72" />;
  if (query.isError && !query.data) {
    return <ErrorState message={query.error instanceof Error ? query.error.message : undefined} />;
  }
  const items = query.data ?? [];
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
      <QueueList
        title="Assigned arrivals"
        empty="No seller stones are assigned for bank receipt."
        items={items.map((item) => ({
          id: item.submissionId,
          title: item.stoneName,
          subtitle: item.sellerName ?? 'Seller',
          status: item.state,
        }))}
        selectedId={selected?.submissionId}
        onSelect={(id) => setSelected(items.find((item) => item.submissionId === id))}
      />
      {!selected ? (
        <EmptyState
          title="Select an arrival"
          hint="Receipt fields become available only for a bank-assigned stone."
        />
      ) : (
        <Card className="p-5">
          <h3 className="text-[15px] font-semibold text-ink">Record storage receipt</h3>
          <p className="mt-1 text-[12px] text-ink-muted">{selected.stoneName}</p>
          <form onSubmit={(event) => mutation.mutate(event)} className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Assigned vault location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                required
              />
              <Field
                label="Received at"
                type="datetime-local"
                value={receivedAt}
                onChange={(event) => setReceivedAt(event.target.value)}
                required
              />
              <Field
                label="Custody started at"
                type="datetime-local"
                value={custodyStartedAt}
                onChange={(event) => setCustodyStartedAt(event.target.value)}
                required
              />
              <Field
                label="Custody agreement ends"
                type="datetime-local"
                value={reserveEscrowEndsAt}
                onChange={(event) => setReserveEscrowEndsAt(event.target.value)}
                required
              />
            </div>
            <Labeled label="Observed condition notes">
              <textarea
                className={`${inputClass} min-h-28 py-3`}
                value={conditionNotes}
                onChange={(event) => setConditionNotes(event.target.value)}
                required
              />
            </Labeled>
            <label className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-muted">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={matchesDeclared}
                onChange={(event) => setMatchesDeclared(event.target.checked)}
              />
              The received stone and package match the assigned declaration. A mismatch remains
              visible in the receipt rather than being silently accepted.
            </label>
            {mutation.error && (
              <p role="alert" className="text-[12px] text-ruby">
                {mutation.error instanceof Error
                  ? mutation.error.message
                  : 'Receipt could not be recorded.'}
              </p>
            )}
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                !location.trim() ||
                !receivedAt ||
                !custodyStartedAt ||
                !reserveEscrowEndsAt ||
                !conditionNotes.trim()
              }
            >
              {mutation.isPending ? 'Recording…' : 'Record bank receipt'}
            </Button>
          </form>
        </Card>
      )}
      {confirmed && (
        <p
          role="status"
          className="xl:col-span-2 rounded-[4px] border border-emerald/25 bg-emerald/[0.06] p-3 text-[12px] text-emerald"
        >
          {confirmed}
        </p>
      )}
    </div>
  );
}

export function RedemptionArrivalQueue({
  query,
  organizationId,
}: {
  query: UseQueryResult<RedemptionTracker[], Error>;
  organizationId: string;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<RedemptionTracker>();
  const [location, setLocation] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [evidenceId, setEvidenceId] = useState('');
  const [uploadedReceiptEvidence, setUploadedReceiptEvidence] = useState<WorkflowEvidenceView>();
  const [handoverEvidenceId, setHandoverEvidenceId] = useState('');
  const [collectedAt, setCollectedAt] = useState('');
  const [collectedByName, setCollectedByName] = useState('');
  const [proxyUsed, setProxyUsed] = useState(false);
  const [ownerIdentityEvidenceId, setOwnerIdentityEvidenceId] = useState('');
  const detailQuery = useQuery({
    queryKey: ['operations', 'redemption', 'detail', selected?.id, organizationId],
    queryFn: () => loadRedemptionTracker(selected!.id, organizationId),
    enabled: Boolean(selected),
  });
  const detail = detailQuery.data ?? selected;
  const mutation = useMutation({
    mutationFn: async (event: FormEvent) => {
      event.preventDefault();
      if (!selected) throw new Error('Select a redemption first.');
      const intent = `bank:redemption:${selected.id}:receipt`;
      const response = await recordBankRedemptionReceipt({
        requestId: selected.id,
        organizationId,
        expectedVersion: detail?.version ?? selected.version,
        location: location.trim(),
        receivedAt: new Date(receivedAt).toISOString(),
        evidenceId,
        idempotencyKey: operationIdempotencyKey(intent),
      });
      clearOperationIdempotencyKey(intent);
      return response;
    },
    onSuccess: async () => {
      setSelected(undefined);
      setEvidenceId('');
      setUploadedReceiptEvidence(undefined);
      await queryClient.invalidateQueries({ queryKey: ['operations', 'bank', 'redemption'] });
    },
  });
  const handover = useMutation({
    mutationFn: async (event: FormEvent) => {
      event.preventDefault();
      if (!selected || !detail) throw new Error('Reload the pickup request first.');
      const intent = `bank:redemption:${selected.id}:pickup-handover`;
      const result = await recordPickupHandover({
        requestId: selected.id,
        organizationId,
        expectedVersion: detail.version,
        evidenceId: handoverEvidenceId,
        collectedAt: new Date(collectedAt).toISOString(),
        collectedByName: collectedByName.trim(),
        proxyUsed,
        ...(proxyUsed
          ? { collectorWallet: detail.proxyNomination?.proxyWallet }
          : { ownerIdentityEvidenceId }),
        idempotencyKey: operationIdempotencyKey(intent),
      });
      clearOperationIdempotencyKey(intent);
      return result;
    },
    onSuccess: async () => {
      setHandoverEvidenceId('');
      setCollectedAt('');
      setCollectedByName('');
      setProxyUsed(false);
      setOwnerIdentityEvidenceId('');
      await queryClient.invalidateQueries({ queryKey: ['operations', 'redemption'] });
    },
  });
  if (query.isLoading && !query.data) return <Skeleton className="h-72" />;
  if (query.isError && !query.data)
    return <ErrorState message={query.error instanceof Error ? query.error.message : undefined} />;
  const items = query.data ?? [];
  const receiptEvidence = [...(detail?.evidence ?? [])];
  if (
    uploadedReceiptEvidence &&
    !receiptEvidence.some((entry) => entry.id === uploadedReceiptEvidence.id)
  ) {
    receiptEvidence.push(uploadedReceiptEvidence);
  }
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,.75fr)_minmax(0,1.25fr)]">
      <QueueList
        title="Arrivals and pickups"
        empty="No redemption stones are assigned to this bank."
        items={items.map((item) => ({
          id: item.id,
          title: item.gem?.name ?? `Token #${item.tokenId}`,
          subtitle: `Token #${item.tokenId} · ${item.method === 'pickup' ? 'Pickup' : 'Courier'}`,
          status: item.status,
        }))}
        selectedId={selected?.id}
        onSelect={(id) => setSelected(items.find((item) => item.id === id))}
      />
      {!selected ? (
        <EmptyState
          title="Select a redemption"
          hint="The canonical lifecycle and available receipt evidence will appear here."
        />
      ) : (
        <Card className="space-y-5 p-5">
          {detailQuery.isLoading ? (
            <Skeleton className="h-64" />
          ) : (
            detail && (
              <LifecycleTracker
                title="Redemption lifecycle"
                stages={redemptionLifecycleStages(detail)}
                events={eventPresentation(detail.events ?? [])}
              />
            )
          )}
          {detail?.capabilities?.includes('bank_receive_redemption') && (
            <form
              onSubmit={(event) => mutation.mutate(event)}
              className="space-y-3 border-t border-line/[0.07] pt-4"
            >
              <h3 className="text-[13px] font-semibold text-ink">
                Record arrival for owner pickup
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Bank location"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  required
                />
                <Field
                  label="Received at"
                  type="datetime-local"
                  value={receivedAt}
                  onChange={(event) => setReceivedAt(event.target.value)}
                  required
                />
              </div>
              <Labeled label="Receipt evidence">
                <select
                  className={inputClass}
                  value={evidenceId}
                  onChange={(event) => setEvidenceId(event.target.value)}
                  required
                >
                  <option value="">Choose uploaded evidence</option>
                  {receiptEvidence.map((evidence) => (
                    <option key={evidence.id} value={evidence.id}>
                      {evidence.category} · {evidence.sha256.slice(0, 12)}
                    </option>
                  ))}
                </select>
              </Labeled>
              <EvidenceUpload
                requestId={detail.id}
                organizationId={organizationId}
                category="bank_receipt"
                label="Upload arrival evidence"
                onUploaded={(uploaded) => {
                  setUploadedReceiptEvidence(uploaded);
                  setEvidenceId(uploaded.id);
                }}
              />
              {mutation.error && (
                <p role="alert" className="text-[12px] text-ruby">
                  {mutation.error instanceof Error
                    ? mutation.error.message
                    : 'Arrival could not be recorded.'}
                </p>
              )}
              <Button
                type="submit"
                disabled={mutation.isPending || !location.trim() || !receivedAt || !evidenceId}
              >
                {mutation.isPending ? 'Recording…' : 'Record bank arrival'}
              </Button>
            </form>
          )}
          {detail?.capabilities?.includes('record_pickup_handover') && (
            <form
              onSubmit={(event) => handover.mutate(event)}
              className="space-y-3 border-t border-line/[0.07] pt-4"
            >
              <div>
                <h3 className="text-[13px] font-semibold text-ink">Record witnessed pickup</h3>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
                  Record the actual handover. This does not authorize or burn the owner&apos;s
                  token; a custodian proof and independent admin approval still follow.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Collected at"
                  type="datetime-local"
                  value={collectedAt}
                  onChange={(event) => setCollectedAt(event.target.value)}
                  required
                />
                <Field
                  label="Name shown on handover evidence"
                  value={collectedByName}
                  onChange={(event) => setCollectedByName(event.target.value)}
                  required
                />
              </div>
              <label className="flex items-start gap-2 text-[12px] text-ink-muted">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={proxyUsed}
                  onChange={(event) => setProxyUsed(event.target.checked)}
                />
                The stone was collected by the owner&apos;s named proxy. The server will require an
                owner-authorized proxy commitment.
              </label>
              {proxyUsed ? (
                detail.proxyNomination ? (
                  <div className="space-y-2 rounded-[4px] border border-atelier/20 bg-atelier/[0.035] p-3 text-[11.5px]">
                    <p className="font-semibold text-ink">Approved named proxy</p>
                    <p className="text-ink-muted">{detail.proxyNomination.proxyName}</p>
                    <p className="break-all font-mono text-[10.5px] text-ink-dim">
                      {detail.proxyNomination.proxyWallet}
                    </p>
                    <a
                      href={detail.proxyNomination.identityEvidence.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex text-atelier underline underline-offset-2"
                    >
                      Review owner-approved identity evidence ↗
                    </a>
                  </div>
                ) : (
                  <p role="alert" className="text-[11.5px] text-amber">
                    No approved proxy nomination is bound to this request. Do not record a proxy
                    handover.
                  </p>
                )
              ) : (
                <Labeled label="Owner identity evidence">
                  <select
                    className={inputClass}
                    value={ownerIdentityEvidenceId}
                    onChange={(event) => setOwnerIdentityEvidenceId(event.target.value)}
                    required
                  >
                    <option value="">Choose owner-uploaded identity evidence</option>
                    {(detail.evidence ?? [])
                      .filter((entry) => entry.category === 'proxy_identity')
                      .map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.sha256.slice(0, 12)} · verified identity evidence
                        </option>
                      ))}
                  </select>
                </Labeled>
              )}
              <EvidenceUpload
                requestId={detail.id}
                organizationId={organizationId}
                category="bank_handover"
                label="Upload signed handover evidence"
                onUploaded={(uploaded) => setHandoverEvidenceId(uploaded.id)}
              />
              {handover.error && (
                <p role="alert" className="text-[12px] text-ruby">
                  {handover.error instanceof Error
                    ? handover.error.message
                    : 'Pickup handover could not be recorded.'}
                </p>
              )}
              <Button
                type="submit"
                disabled={
                  handover.isPending ||
                  !handoverEvidenceId ||
                  !collectedAt ||
                  collectedByName.trim().length < 2 ||
                  (proxyUsed ? !detail.proxyNomination : !ownerIdentityEvidenceId)
                }
              >
                {handover.isPending ? 'Recording…' : 'Record witnessed pickup'}
              </Button>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}

function QueueList({
  title,
  empty,
  items,
  selectedId,
  onSelect,
}: {
  title: string;
  empty: string;
  items: Array<{ id: string; title: string; subtitle: string; status: string }>;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Card className="p-0">
      <div className="border-b border-line/[0.07] px-4 py-3">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
      </div>
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
                <span>
                  <span className="block text-[13px] font-semibold text-ink">{item.title}</span>
                  <span className="mt-1 block text-[11px] text-ink-muted">{item.subtitle}</span>
                </span>
                <StatusBadge tone="neutral">{item.status.replaceAll('_', ' ')}</StatusBadge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

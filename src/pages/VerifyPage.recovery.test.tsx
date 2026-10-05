import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RedemptionTracker } from '@/services/offchain/operations';
import type { TxResult } from '@/services/types';

const WALLET = '0x1111111111111111111111111111111111111111' as const;
const HASH = `0x${'9'.repeat(64)}` as const;
const PROPOSAL = `0x${'2'.repeat(64)}` as const;
const EVIDENCE_DIGEST = `0x${'3'.repeat(64)}` as const;

const mocks = vi.hoisted(() => ({
  loadDetail: vi.fn(),
  mutateRecovery: vi.fn(),
  resume: vi.fn(),
  propose: vi.fn(),
  approve: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('wagmi', () => ({ useAccount: () => ({ address: WALLET }) }));
vi.mock('@/hooks/useOperationsAccess', () => ({
  useOperationsAccess: () => ({
    data: {
      memberships: [
        {
          organizationId: 'recovery-org',
          capabilities: ['admin.read', 'redemption.recover'],
        },
      ],
    },
  }),
}));
vi.mock('@/services', () => ({
  dataService: {
    proposeRedemptionRecovery: mocks.propose,
    approveRedemptionRecovery: mocks.approve,
    executeRedemptionRecovery: mocks.execute,
  },
}));
vi.mock('@/services/offchain/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/offchain/operations')>()),
  loadRedemptionTracker: mocks.loadDetail,
  mutateRedemptionRecovery: mocks.mutateRecovery,
  resumeRedemptionActionIntent: mocks.resume,
}));
vi.mock('@/components/operations/EvidenceUpload', () => ({
  EvidenceUpload: ({ onUploaded }: { onUploaded: (value: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onUploaded({
          id: 'evidence-1',
          category: 'recovery_evidence',
          mimeType: 'application/pdf',
          byteSize: 42,
          sha256: 'abc',
        })
      }
    >
      Upload test recovery evidence
    </button>
  ),
}));
vi.mock('@/components/tx/TxButton', () => ({
  TxButton: ({
    action,
    onConfirmed,
    children,
  }: {
    action: () => Promise<TxResult>;
    onConfirmed?: (result: TxResult) => Promise<void> | void;
    children: import('react').ReactNode;
  }) => (
    <button type="button" onClick={() => void action().then((result) => onConfirmed?.(result))}>
      {children}
    </button>
  ),
}));

import { RedemptionReview } from './VerifyPage';

type RecoveryAction = 'propose_recovery' | 'approve_recovery' | 'execute_recovery';

function tracker(action: RecoveryAction): RedemptionTracker {
  const recovery =
    action === 'propose_recovery'
      ? null
      : {
          proposalId: 'proposal-1',
          proposalHash: PROPOSAL,
          evidenceDigest: EVIDENCE_DIGEST,
          executeAfter:
            action === 'execute_recovery' ? '2020-01-01T00:00:00.000Z' : '2030-01-01T00:00:00.000Z',
          requiredApprovals: 2,
          approvals: action === 'execute_recovery' ? 2 : 1,
          state: action === 'execute_recovery' ? ('approved' as const) : ('proposed' as const),
        };
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tokenId: '42',
    method: 'insured_delivery',
    status: 'proof_approved',
    version: 7,
    requestHash: `0x${'1'.repeat(64)}`,
    updatedAt: '2026-10-04T00:00:00.000Z',
    recoveryEligibleAt: '2026-10-01T00:00:00.000Z',
    steps: [],
    events: [],
    capabilities: [action],
    recovery,
  };
}

function renderReview(value: RedemptionTracker) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RedemptionReview workflow={value} canCorrect={false} />
    </QueryClientProvider>,
  );
}

describe('redemption emergency recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.propose.mockResolvedValue({ hash: HASH, status: 'success' });
    mocks.approve.mockResolvedValue({ hash: HASH, status: 'success' });
    mocks.execute.mockResolvedValue({ hash: HASH, status: 'success' });
  });

  it('requires verified evidence and persists a proposal only after its wallet receipt', async () => {
    const value = tracker('propose_recovery');
    mocks.loadDetail.mockResolvedValue(value);
    mocks.resume.mockResolvedValue(null);
    mocks.mutateRecovery.mockImplementation(
      async (_action: RecoveryAction, input: { transactionHash?: string }) =>
        input.transactionHash
          ? { request: { ...value, version: 8 } }
          : {
              request: value,
              chainAction: 'proposeRecovery',
              args: { tokenId: '42', evidenceDigest: EVIDENCE_DIGEST },
            },
    );
    renderReview(value);

    const prepare = await screen.findByRole('button', { name: 'Prepare recovery proposal' });
    expect(prepare).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Upload test recovery evidence' }));
    expect(prepare).toBeEnabled();
    fireEvent.click(prepare);
    const sign = await screen.findByRole('button', { name: 'Propose recovery in wallet' });
    expect(mocks.propose).not.toHaveBeenCalled();
    expect(mocks.mutateRecovery).toHaveBeenCalledWith(
      'propose_recovery',
      expect.objectContaining({ evidenceId: 'evidence-1', recoveryWallet: WALLET }),
    );

    fireEvent.click(sign);
    await waitFor(() =>
      expect(mocks.propose).toHaveBeenCalledWith({
        tokenId: 42n,
        evidenceDigest: EVIDENCE_DIGEST,
      }),
    );
    await waitFor(() =>
      expect(mocks.mutateRecovery).toHaveBeenLastCalledWith(
        'propose_recovery',
        expect.objectContaining({ transactionHash: HASH, evidenceId: 'evidence-1' }),
      ),
    );
  });

  it.each([
    {
      action: 'propose_recovery' as const,
      chainAction: 'proposeRecovery' as const,
      label: 'Propose recovery in wallet',
      chain: () => mocks.propose,
      args: { tokenId: '42', evidenceDigest: EVIDENCE_DIGEST },
      payload: { recoveryWallet: WALLET, evidenceId: 'evidence-1' },
    },
    {
      action: 'approve_recovery' as const,
      chainAction: 'approveRecovery' as const,
      label: 'Approve with this distinct wallet',
      chain: () => mocks.approve,
      args: { tokenId: '42', proposalHash: PROPOSAL },
      payload: { recoveryWallet: WALLET, proposalHash: PROPOSAL },
    },
    {
      action: 'execute_recovery' as const,
      chainAction: 'executeRecovery' as const,
      label: 'Execute delayed recovery',
      chain: () => mocks.execute,
      args: { tokenId: '42', proposalHash: PROPOSAL },
      payload: { recoveryWallet: WALLET, proposalHash: PROPOSAL },
    },
  ])('resumes $action with the stored server intent and exact arguments', async (scenario) => {
    const value = tracker(scenario.action);
    mocks.loadDetail.mockResolvedValue(value);
    mocks.resume.mockResolvedValue({
      action: scenario.action,
      idempotencyKey: `intent-${scenario.action}`,
      expectedVersion: 7,
      payload: scenario.payload,
      chainArguments: scenario.args,
      transactionHash: null,
      createdAt: '2026-10-04T00:00:00.000Z',
    });
    mocks.mutateRecovery.mockResolvedValue({ request: { ...value, version: 8 } });
    renderReview(value);

    const sign = await screen.findByRole('button', { name: scenario.label });
    expect(mocks.mutateRecovery).not.toHaveBeenCalled();
    fireEvent.click(sign);
    await waitFor(() => expect(scenario.chain()).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(mocks.mutateRecovery).toHaveBeenCalledWith(
        scenario.action,
        expect.objectContaining({
          idempotencyKey: `intent-${scenario.action}`,
          expectedVersion: 7,
          recoveryWallet: WALLET,
          transactionHash: HASH,
        }),
      ),
    );
  });

  it('keeps execution unavailable until the server-derived grace time passes', async () => {
    const value = tracker('execute_recovery');
    value.recovery = { ...value.recovery!, executeAfter: '2035-01-01T00:00:00.000Z' };
    mocks.loadDetail.mockResolvedValue(value);
    mocks.resume.mockResolvedValue(null);
    renderReview(value);

    expect(await screen.findByText(/seven-day grace period ends/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Prepare recovery execution' }),
    ).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RedemptionTracker } from '@/services/offchain/operations';
import type { TxResult } from '@/services/types';

const mocks = vi.hoisted(() => ({
  loadDetail: vi.fn(),
  rejectProof: vi.fn(),
  resume: vi.fn(),
  rejectChain: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x1111111111111111111111111111111111111111' }),
}));
vi.mock('@/hooks/useOperationsAccess', () => ({
  useOperationsAccess: () => ({
    data: {
      memberships: [
        {
          organizationId: 'admin-org',
          capabilities: ['admin.read', 'redemption.approve'],
        },
      ],
    },
  }),
}));
vi.mock('@/services', () => ({
  dataService: { rejectFulfillmentProof: mocks.rejectChain },
}));
vi.mock('@/services/offchain/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/offchain/operations')>()),
  loadRedemptionTracker: mocks.loadDetail,
  rejectRedemptionProof: mocks.rejectProof,
  resumeRedemptionActionIntent: mocks.resume,
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

function tracker(method: RedemptionTracker['method']): RedemptionTracker {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tokenId: '42',
    method,
    status: method === 'pickup' ? 'pickup_proof_submitted' : 'delivery_proof_submitted',
    version: 5,
    requestHash: `0x${'1'.repeat(64)}`,
    proofDigest: `0x${'2'.repeat(64)}`,
    proofVersion: 1,
    updatedAt: '2026-10-04T00:00:00.000Z',
    recoveryEligibleAt: null,
    steps: [],
    events: [],
    capabilities: ['reject_fulfillment_proof'],
  };
}

describe.each(['pickup', 'insured_delivery'] as const)('%s proof rejection', (method) => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    const detail = tracker(method);
    mocks.loadDetail.mockResolvedValue(detail);
    mocks.resume.mockResolvedValue(null);
    mocks.rejectProof.mockImplementation(async (input: { transactionHash?: string }) =>
      input.transactionHash
        ? {
            request: {
              ...detail,
              status: method === 'pickup' ? 'pickup_handover_recorded' : 'custodian_dispatched',
            },
          }
        : {
            request: detail,
            chainAction: 'rejectFulfillmentProof',
            args: { tokenId: '42', reasonHash: `0x${'3'.repeat(64)}` },
          },
    );
    mocks.rejectChain.mockResolvedValue({ hash: `0x${'4'.repeat(64)}`, status: 'success' });
  });

  it('does not show rejection success until the wallet receipt is persisted', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RedemptionReview workflow={tracker(method)} canCorrect={false} />
      </QueryClientProvider>,
    );

    await screen.findByText('Rejection reason');
    const reason = screen.getByText('Rejection reason').parentElement?.querySelector('textarea');
    expect(reason).toBeTruthy();
    fireEvent.change(reason!, {
      target: { value: 'The handover image does not show the sealed package.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare proof rejection' }));
    const confirm = await screen.findByRole('button', { name: 'Reject proof in wallet' });
    expect(mocks.rejectChain).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.rejectChain).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(mocks.rejectProof).toHaveBeenLastCalledWith(
        expect.objectContaining({
          transactionHash: `0x${'4'.repeat(64)}`,
          reason: 'The handover image does not show the sealed package.',
          approverWallet: '0x1111111111111111111111111111111111111111',
        }),
      ),
    );
  });
});

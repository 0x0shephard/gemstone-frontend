import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TxResult } from '@/services/types';

const mocks = vi.hoisted(() => ({
  loadDetail: vi.fn(),
  finalize: vi.fn(),
  markBurned: vi.fn(),
  cancel: vi.fn(),
  prepareCancellation: vi.fn(),
  resume: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x1111111111111111111111111111111111111111' }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
}));
vi.mock('@/services', () => ({
  dataService: { finalizeRedemption: mocks.finalize, cancelRedemption: mocks.cancel },
}));
vi.mock('@/services/offchain/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/offchain/operations')>()),
  loadRedemptionTracker: mocks.loadDetail,
  markRedemptionChainBurned: mocks.markBurned,
  prepareRedemptionCancellation: mocks.prepareCancellation,
  resumeRedemptionActionIntent: mocks.resume,
}));
vi.mock('@/components/tx/TxButton', async () => {
  return {
    TxButton: ({
      action,
      onConfirmed,
      children,
    }: {
      action: () => Promise<TxResult>;
      onConfirmed?: (result: TxResult) => Promise<void> | void;
      children: import('react').ReactNode;
    }) => (
      <button
        type="button"
        onClick={() => void action().then(async (result) => onConfirmed?.(result))}
      >
        {children}
      </button>
    ),
  };
});

import { OwnerRedemptionCard } from './RedeemPage';

const authorization = {
  tokenId: '42',
  owner: '0x1111111111111111111111111111111111111111',
  requestHash: `0x${'1'.repeat(64)}` as const,
  workflowIdHash: `0x${'2'.repeat(64)}` as const,
  proofDigest: `0x${'3'.repeat(64)}` as const,
  proofVersion: 1,
  approvalId: `0x${'4'.repeat(64)}` as const,
  approvalVersion: 2,
  collectorCommitment: `0x${'5'.repeat(64)}` as const,
  nonce: `0x${'6'.repeat(64)}` as const,
  issuedAt: 1_800_000_000,
  deadline: 1_800_000_300,
  authorizer: '0x2222222222222222222222222222222222222222',
  signature: `0x${'7'.repeat(130)}` as const,
};
const tracker = {
  id: '11111111-1111-4111-8111-111111111111',
  tokenId: '42',
  method: 'pickup' as const,
  status: 'owner_authorized',
  version: 8,
  requestHash: authorization.requestHash,
  ownerWallet: authorization.owner,
  updatedAt: '2026-10-03T00:00:00.000Z',
  recoveryEligibleAt: null,
  authorizationExpiresAt: '2027-01-15T08:05:00.000Z',
  authorization,
  capabilities: ['mark_chain_burned'],
  steps: [],
  events: [],
};

describe('owner redemption finalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.loadDetail.mockResolvedValue(tracker);
    mocks.finalize.mockResolvedValue({
      hash: `0x${'8'.repeat(64)}`,
      status: 'success',
    });
    mocks.markBurned.mockResolvedValue({ request: { ...tracker, status: 'chain_burned' } });
    mocks.resume.mockResolvedValue(null);
  });

  it('recovers an unexpired server authorization after reload and persists only after receipt', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <OwnerRedemptionCard summary={{ ...tracker, authorization: undefined }} />
      </QueryClientProvider>,
    );

    const burn = await screen.findByRole('button', {
      name: 'Burn token and complete redemption',
    });
    expect(mocks.markBurned).not.toHaveBeenCalled();
    fireEvent.click(burn);

    await waitFor(() =>
      expect(mocks.finalize).toHaveBeenCalledWith({
        tokenId: 42n,
        nonce: authorization.nonce,
        issuedAt: 1_800_000_000n,
        deadline: 1_800_000_300n,
        authorizer: authorization.authorizer,
        signature: authorization.signature,
      }),
    );
    await waitFor(() =>
      expect(mocks.markBurned).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: tracker.id,
          expectedVersion: 8,
          transactionHash: `0x${'8'.repeat(64)}`,
        }),
      ),
    );
  });

  it('does not offer an expired persisted authorization for irreversible burn', async () => {
    const expired = {
      ...tracker,
      authorization: { ...authorization, issuedAt: 1, deadline: 2 },
      authorizationExpiresAt: '1970-01-01T00:00:02.000Z',
      capabilities: ['resend_owner_code', 'prepare_owner_authorization', 'authorize_owner'],
    };
    mocks.loadDetail.mockResolvedValue(expired);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <OwnerRedemptionCard summary={expired} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Resend code' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Burn token and complete redemption' }),
    ).not.toBeInTheDocument();
  });

  it('recovers a prepared cancellation after reload and persists only after its receipt', async () => {
    const cancellable = {
      ...tracker,
      status: 'requested',
      authorization: undefined,
      capabilities: ['cancel_redemption'],
    };
    mocks.loadDetail.mockResolvedValue(cancellable);
    mocks.resume.mockResolvedValue({
      action: 'cancel_redemption',
      idempotencyKey: 'cancel-intent',
      expectedVersion: 8,
      payload: {},
      chainArguments: { tokenId: '42' },
      transactionHash: null,
      createdAt: '2026-10-04T00:00:00.000Z',
    });
    mocks.cancel.mockResolvedValue({ hash: `0x${'9'.repeat(64)}`, status: 'success' });
    mocks.prepareCancellation.mockResolvedValue({
      request: { ...cancellable, status: 'cancelled' },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <OwnerRedemptionCard summary={cancellable} />
      </QueryClientProvider>,
    );

    const cancel = await screen.findByRole('button', { name: 'Cancel redemption in wallet' });
    expect(mocks.prepareCancellation).not.toHaveBeenCalled();
    fireEvent.click(cancel);
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith({ tokenId: 42n }));
    await waitFor(() =>
      expect(mocks.prepareCancellation).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: tracker.id,
          idempotencyKey: 'cancel-intent',
          transactionHash: `0x${'9'.repeat(64)}`,
        }),
      ),
    );
  });
});

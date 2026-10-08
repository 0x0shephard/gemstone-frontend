import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationsOrganization, RedemptionTracker } from '@/services/offchain/operations';

const mocks = vi.hoisted(() => ({ loadDetail: vi.fn(), accept: vi.fn(), release: vi.fn() }));

vi.mock('wagmi', () => ({ useAccount: () => ({ address: undefined }) }));
vi.mock('@/hooks/useOperationsAccess', () => ({
  useOperationsAccess: () => ({
    data: {
      memberships: [
        {
          organizationId: 'admin-org',
          capabilities: ['admin.read', 'admin.correct', 'redemption.approve'],
        },
      ],
    },
  }),
}));
vi.mock('@/services/offchain/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/offchain/operations')>()),
  loadRedemptionTracker: mocks.loadDetail,
  acceptRedemption: mocks.accept,
  releaseRedemptionOwnerCode: mocks.release,
}));
vi.mock('@/services', () => ({ dataService: {} }));

import { RedemptionReview } from './VerifyPage';

const organizations: OperationsOrganization[] = [
  { id: 'custodian-1', name: 'Secure Custody', kind: 'custodian' },
  { id: 'bank-1', name: 'Storage Bank', kind: 'bank' },
];

function tracker(status: string, capabilities: string[]): RedemptionTracker {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tokenId: '42',
    method: 'pickup',
    status,
    version: 2,
    requestHash: `0x${'1'.repeat(64)}`,
    updatedAt: '2026-10-08T00:00:00.000Z',
    recoveryEligibleAt: null,
    steps: [],
    events: [],
    capabilities,
    assignment: null,
  };
}

function renderReview(value: RedemptionTracker) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.loadDetail.mockResolvedValue(value);
  return render(
    <QueryClientProvider client={client}>
      <RedemptionReview workflow={value} canCorrect organizations={organizations} />
    </QueryClientProvider>,
  );
}

describe('redemption acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.accept.mockResolvedValue({ request: tracker('accepted', []) });
    mocks.release.mockResolvedValue({ request: tracker('proof_approved', []) });
  });

  it('uses the bank from the seller cycle and asks only for the custodian', async () => {
    renderReview({
      ...tracker('onchain_requested', ['accept_redemption']),
      storageBank: { id: 'bank-1', name: 'Storage Bank' },
    });

    const submit = await screen.findByRole('button', { name: 'Accept request' });
    expect(await screen.findByText('Storage Bank')).toBeInTheDocument();
    expect(screen.getByText('From the bank receipt in the seller cycle.')).toBeInTheDocument();
    expect(submit).toBeDisabled();
    const custodian = screen
      .getByText('Delivery custodian')
      .parentElement!.querySelector('select')!;
    const choices = [...custodian.querySelectorAll('option')].map((option) => option.textContent);
    expect(choices).toEqual(['Choose the custodian that delivers it', 'Secure Custody']);
    fireEvent.change(custodian, { target: { value: 'custodian-1' } });
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.accept).toHaveBeenCalled());
    const input = mocks.accept.mock.calls[0][0];
    expect(input).toMatchObject({
      organizationId: 'admin-org',
      expectedVersion: 2,
      custodianOrganizationId: 'custodian-1',
    });
    // The server reads the recorded bank itself; the client does not override it.
    expect(input).not.toHaveProperty('bankOrganizationId');
  });

  it('asks for the bank when no seller-cycle receipt names one', async () => {
    renderReview(tracker('onchain_requested', ['accept_redemption']));
    const submit = await screen.findByRole('button', { name: 'Accept request' });
    const bank = screen.getByText('Storage bank').parentElement!.querySelector('select')!;
    fireEvent.change(bank, { target: { value: 'bank-1' } });
    fireEvent.change(
      screen.getByText('Delivery custodian').parentElement!.querySelector('select')!,
      { target: { value: 'custodian-1' } },
    );
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mocks.accept).toHaveBeenCalledWith(
        expect.objectContaining({
          bankOrganizationId: 'bank-1',
          custodianOrganizationId: 'custodian-1',
        }),
      ),
    );
  });

  it('can send the customer code once the custodian recorded delivery', async () => {
    renderReview(tracker('arrived', ['release_owner_code']));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve delivery and send code' }));
    await waitFor(() =>
      expect(mocks.release).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'admin-org', expectedVersion: 2 }),
      ),
    );
  });

  it('offers no acceptance once the request has moved on', async () => {
    renderReview(tracker('custodian_collected', []));
    await screen.findByText('Redemption lifecycle');
    expect(screen.queryByRole('button', { name: 'Accept request' })).not.toBeInTheDocument();
  });
});

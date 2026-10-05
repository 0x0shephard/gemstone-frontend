import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationsOrganization, RedemptionTracker } from '@/services/offchain/operations';

const mocks = vi.hoisted(() => ({ loadDetail: vi.fn(), assign: vi.fn() }));

vi.mock('wagmi', () => ({ useAccount: () => ({ address: undefined }) }));
vi.mock('@/hooks/useOperationsAccess', () => ({
  useOperationsAccess: () => ({
    data: {
      memberships: [{ organizationId: 'admin-org', capabilities: ['admin.read', 'admin.correct'] }],
    },
  }),
}));
vi.mock('@/services/offchain/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/offchain/operations')>()),
  loadRedemptionTracker: mocks.loadDetail,
  assignRedemption: mocks.assign,
}));
vi.mock('@/services', () => ({ dataService: {} }));

import { RedemptionReview } from './VerifyPage';

const organizations: OperationsOrganization[] = [
  { id: 'custodian-1', name: 'Secure Custody', kind: 'custodian' },
  { id: 'bank-1', name: 'Storage Bank', kind: 'bank' },
];

function tracker(method: RedemptionTracker['method']): RedemptionTracker {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tokenId: '42',
    method,
    status: 'requested',
    version: 2,
    requestHash: `0x${'1'.repeat(64)}`,
    updatedAt: '2026-10-04T00:00:00.000Z',
    recoveryEligibleAt: null,
    steps: [],
    events: [],
    capabilities: [],
    assignment: null,
  };
}

function renderReview(value: RedemptionTracker, canCorrect = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RedemptionReview workflow={value} canCorrect={canCorrect} organizations={organizations} />
    </QueryClientProvider>,
  );
}

function selectFor(label: string) {
  const select = screen.getByText(label).parentElement?.querySelector('select');
  if (!select) throw new Error(`Missing select for ${label}`);
  return select;
}

describe('redemption fulfillment assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.assign.mockResolvedValue({
      assignment: {
        custodianOrganizationId: 'custodian-1',
        bankOrganizationId: 'bank-1',
      },
      event: {},
    });
  });

  it('requires active custodian and bank choices for pickup before assigning', async () => {
    const value = tracker('pickup');
    mocks.loadDetail.mockResolvedValue(value);
    renderReview(value);

    const submit = await screen.findByRole('button', { name: 'Assign fulfillment teams' });
    fireEvent.change(selectFor('Assigned custodian'), { target: { value: 'custodian-1' } });
    expect(submit).toBeDisabled();
    fireEvent.change(selectFor('Assigned storage bank'), { target: { value: 'bank-1' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'admin-org',
          requestId: value.id,
          expectedVersion: 2,
          custodianOrganizationId: 'custodian-1',
          bankOrganizationId: 'bank-1',
        }),
      ),
    );
  });

  it('allows courier assignment without a storage bank', async () => {
    const value = tracker('insured_delivery');
    mocks.loadDetail.mockResolvedValue(value);
    renderReview(value);
    const submit = await screen.findByRole('button', { name: 'Assign fulfillment teams' });
    fireEvent.change(selectFor('Assigned custodian'), { target: { value: 'custodian-1' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith(
        expect.objectContaining({ bankOrganizationId: null }),
      ),
    );
  });

  it('does not render assignment controls without correction authority', async () => {
    const value = tracker('pickup');
    mocks.loadDetail.mockResolvedValue(value);
    renderReview(value, false);
    await screen.findByText('Redemption lifecycle');
    expect(screen.queryByText('Fulfillment assignment')).not.toBeInTheDocument();
  });
});

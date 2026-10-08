import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { RedemptionTracker } from '@/services/offchain/operations';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  confirm: vi.fn(),
  arrival: vi.fn(),
  release: vi.fn(),
}));

vi.mock('@/components/operations/OperationsAccessGate', () => ({
  OperationsAccessGate: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/hooks/useOperationsAccess', () => ({
  useOperationsAccess: () => ({
    data: { memberships: [{ organizationId: 'vault-org', capabilities: ['custodian.fulfill'] }] },
  }),
}));
vi.mock('@/components/operations/EvidenceUpload', () => ({
  EvidenceUpload: ({ onUploaded }: { onUploaded: (value: unknown) => void }) => (
    <button type="button" onClick={() => onUploaded({ id: 'evidence-1', sha256: 'a'.repeat(64) })}>
      Upload evidence
    </button>
  ),
}));
vi.mock('@/services/offchain/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/offchain/operations')>()),
  listRedemptionTrackers: mocks.list,
  loadRedemptionTracker: mocks.detail,
  confirmVaultCollection: mocks.confirm,
  recordRedemptionArrival: mocks.arrival,
  releaseRedemptionOwnerCode: mocks.release,
}));

import CustodianPage from './CustodianPage';

function tracker(status: string, capabilities: string[], version = 3): RedemptionTracker {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tokenId: '42',
    method: 'pickup',
    status,
    version,
    requestHash: `0x${'1'.repeat(64)}`,
    updatedAt: '2026-10-08T00:00:00.000Z',
    recoveryEligibleAt: null,
    steps: [],
    events: [],
    capabilities,
  };
}

async function openRequest(value: RedemptionTracker) {
  mocks.list.mockResolvedValue([value]);
  mocks.detail.mockResolvedValue(value);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CustodianPage />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Token #42/ }));
}

describe('custodian vault desk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('confirms an accepted request without a wallet', async () => {
    mocks.confirm.mockResolvedValue({ request: tracker('custodian_collected', []) });
    await openRequest(tracker('accepted', ['custodian_collect']));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm request receipt' }));
    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'vault-org', expectedVersion: 3 }),
      ),
    );
  });

  it('records arrival and then sends the customer their code', async () => {
    mocks.arrival.mockResolvedValue({ request: tracker('arrived', [], 7) });
    mocks.release.mockResolvedValue({ request: tracker('proof_approved', [], 8) });
    await openRequest(tracker('custodian_dispatched', ['record_arrival'], 6));

    fireEvent.click(await screen.findByRole('button', { name: 'Upload evidence' }));
    fireEvent.change(screen.getByLabelText('Arrived at'), {
      target: { value: '2026-10-08T10:00' },
    });
    fireEvent.change(screen.getByLabelText('Pickup point'), {
      target: { value: 'Islamabad branch' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record arrival' }));

    await waitFor(() =>
      expect(mocks.arrival).toHaveBeenCalledWith(
        expect.objectContaining({
          evidenceId: 'evidence-1',
          location: 'Islamabad branch',
          expectedVersion: 6,
        }),
      ),
    );
    // The code release uses the version the arrival produced.
    await waitFor(() =>
      expect(mocks.release).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'vault-org', expectedVersion: 7 }),
      ),
    );
  });
});

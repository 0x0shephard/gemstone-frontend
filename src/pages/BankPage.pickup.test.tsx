import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RedemptionTracker } from '@/services/offchain/operations';

const mocks = vi.hoisted(() => ({ loadDetail: vi.fn(), recordHandover: vi.fn() }));

vi.mock('@/services/offchain/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/offchain/operations')>()),
  loadRedemptionTracker: mocks.loadDetail,
  recordPickupHandover: mocks.recordHandover,
}));
vi.mock('@/components/operations/EvidenceUpload', () => ({
  EvidenceUpload: ({ onUploaded }: { onUploaded: (value: { id: string }) => void }) => (
    <button type="button" onClick={() => onUploaded({ id: 'handover-evidence' })}>
      Upload handover evidence
    </button>
  ),
}));

import { RedemptionArrivalQueue } from './BankPage';

const base: RedemptionTracker = {
  id: '11111111-1111-4111-8111-111111111111',
  tokenId: '42',
  method: 'pickup',
  status: 'bank_received',
  version: 4,
  requestHash: `0x${'1'.repeat(64)}`,
  updatedAt: '2026-10-04T00:00:00.000Z',
  recoveryEligibleAt: null,
  steps: [],
  events: [],
  capabilities: ['record_pickup_handover'],
  evidence: [
    {
      id: 'owner-identity',
      category: 'proxy_identity',
      mimeType: 'image/jpeg',
      byteSize: 10,
      sha256: 'owner-identity-hash',
    },
  ],
};

function renderQueue(detail: RedemptionTracker) {
  mocks.loadDetail.mockResolvedValue(detail);
  const query = {
    data: [base],
    isLoading: false,
    isError: false,
  } as unknown as UseQueryResult<RedemptionTracker[], Error>;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RedemptionArrivalQueue query={query} organizationId="bank-org" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Token #42/i }));
}

function field(label: string, selector: 'input' | 'select') {
  const element = screen.getByText(label).parentElement?.querySelector(selector);
  if (!element) throw new Error(`Missing ${selector} for ${label}`);
  return element;
}

async function fillCommon() {
  await screen.findByRole('heading', { name: 'Record witnessed pickup' });
  fireEvent.change(field('Collected at', 'input'), { target: { value: '2026-10-04T12:00' } });
  fireEvent.change(field('Name shown on handover evidence', 'input'), {
    target: { value: 'Owner Person' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload handover evidence' }));
}

describe('bank witnessed pickup binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.recordHandover.mockResolvedValue({ request: { ...base, version: 5 } });
  });

  it('sends owner-uploaded identity evidence for direct collection', async () => {
    renderQueue(base);
    await fillCommon();
    fireEvent.change(field('Owner identity evidence', 'select'), {
      target: { value: 'owner-identity' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Record witnessed pickup' }).closest('form')!,
    );

    await waitFor(() =>
      expect(mocks.recordHandover).toHaveBeenCalledWith(
        expect.objectContaining({
          proxyUsed: false,
          ownerIdentityEvidenceId: 'owner-identity',
        }),
      ),
    );
  });

  it('uses the exact approved proxy wallet and shows its nomination evidence', async () => {
    const detail: RedemptionTracker = {
      ...base,
      proxyNomination: {
        id: 'nomination-1',
        proxyName: 'Named Proxy',
        proxyWallet: '0x2222222222222222222222222222222222222222',
        collectorCommitment: `0x${'2'.repeat(64)}`,
        identityEvidence: {
          id: 'proxy-id',
          mimeType: 'image/jpeg',
          sha256: 'proxy-hash',
          downloadUrl: 'https://example.test/signed-evidence',
          expiresIn: 300,
        },
        createdAt: '2026-10-04T00:00:00.000Z',
      },
    };
    renderQueue(detail);
    await fillCommon();
    fireEvent.click(
      screen.getByRole('checkbox', { name: /collected by the owner's named proxy/i }),
    );
    expect(screen.getByText('Named Proxy')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /review owner-approved identity evidence/i }),
    ).toHaveAttribute('href', 'https://example.test/signed-evidence');
    fireEvent.submit(
      screen.getByRole('button', { name: 'Record witnessed pickup' }).closest('form')!,
    );

    await waitFor(() =>
      expect(mocks.recordHandover).toHaveBeenCalledWith(
        expect.objectContaining({
          proxyUsed: true,
          collectorWallet: '0x2222222222222222222222222222222222222222',
        }),
      ),
    );
  });
});

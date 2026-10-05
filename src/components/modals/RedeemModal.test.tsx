import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecoratedGem, TxResult } from '@/services/types';

const mocks = vi.hoisted(() => ({
  createCommitment: vi.fn(),
  getWorkflow: vi.fn(),
  requestRedemption: vi.fn(),
  markOnchainRequested: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x1111111111111111111111111111111111111111' }),
}));
vi.mock('@/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/env')>();
  return { ...actual, env: { ...actual.env, dataMode: 'chain' } };
});
vi.mock('@/services', () => ({
  dataService: { requestRedemption: mocks.requestRedemption },
}));
vi.mock('@/services/offchain/workflows', () => ({
  createRedemptionCommitment: mocks.createCommitment,
}));
vi.mock('@/services/offchain/redemptions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/offchain/redemptions')>()),
  getRedemptionWorkflow: mocks.getWorkflow,
}));
vi.mock('@/services/offchain/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/offchain/operations')>()),
  markRedemptionOnchainRequested: mocks.markOnchainRequested,
}));
vi.mock('@/components/modals/parts', () => ({
  ModalGemHeader: () => null,
  SummaryRow: () => null,
  assetAmountPreview: () => '',
}));
vi.mock('@/components/tx/TxButton', async () => {
  const React = await import('react');
  return {
    TxButton: ({
      action,
      onConfirmed,
      children,
      disabled,
    }: {
      action: () => Promise<TxResult>;
      onConfirmed?: (result: TxResult) => Promise<void> | void;
      children: React.ReactNode;
      disabled?: boolean;
    }) => {
      const [error, setError] = React.useState('');
      return (
        <>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              void action()
                .then(async (result) => onConfirmed?.(result))
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : 'Transaction failed'),
                );
            }}
          >
            {children}
          </button>
          {error && <p role="alert">{error}</p>}
        </>
      );
    },
  };
});

import { RedeemModal } from './index';

const requestHash = `0x${'a'.repeat(64)}` as const;
const transactionHash = `0x${'b'.repeat(64)}` as const;
const workflowIdHash = `0x${'c'.repeat(64)}` as const;
const gem = {
  gemId: 7n,
  tokenId: 42n,
  redeem: 'Eligible',
  reserveBalanceUsd: 20n,
  reserveShortfallUsd: 80n,
} as DecoratedGem;

describe('RedeemModal', () => {
  beforeEach(() => {
    mocks.createCommitment.mockReset();
    mocks.getWorkflow.mockReset();
    mocks.requestRedemption.mockReset();
    mocks.markOnchainRequested.mockReset();
    mocks.createCommitment.mockResolvedValue({
      workflowId: 'request-123',
      requestHash,
      workflowIdHash,
    });
    mocks.requestRedemption.mockResolvedValue({ hash: transactionHash, status: 'success' });
    mocks.markOnchainRequested.mockResolvedValue({});
  });

  it('shows a receipt only after chain confirmation and a persisted backend workflow', async () => {
    let resolveWorkflow!: (value: unknown) => void;
    mocks.getWorkflow.mockReturnValue(
      new Promise((resolve) => {
        resolveWorkflow = resolve;
      }),
    );
    render(<RedeemModal gem={gem} open onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Preferred pickup location'), {
      target: { value: '  Zurich vault  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request redemption' }));

    await waitFor(() => expect(mocks.requestRedemption).toHaveBeenCalled());
    expect(mocks.requestRedemption).toHaveBeenCalledWith({
      tokenId: 42n,
      requestHash,
      workflowIdHash,
    });
    expect(screen.queryByText('Redemption request recorded')).not.toBeInTheDocument();
    expect(mocks.createCommitment).toHaveBeenCalledWith(
      expect.objectContaining({
        fulfillmentMethod: 'pickup',
        fulfillmentDetails: { pickupLocation: 'Zurich vault' },
      }),
    );

    resolveWorkflow({
      workflowId: 'request-123',
      tokenId: '42',
      method: 'pickup',
      status: 'committed',
      requestHash,
      transactionHash: null,
      createdAt: '2026-10-02T12:00:00.000Z',
    });
    expect(await screen.findByText('Redemption request recorded')).toBeInTheDocument();
    expect(mocks.markOnchainRequested).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'request-123', transactionHash }),
    );
    expect(screen.getByText('request-123')).toBeInTheDocument();
    expect(screen.getByText(requestHash)).toBeInTheDocument();
  });

  it('submits the insured-delivery shape and surfaces its exact server error', async () => {
    mocks.createCommitment.mockRejectedValueOnce(
      new Error('Complete insured-delivery details are required'),
    );
    render(<RedeemModal gem={gem} open onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'insured_delivery' } });
    fireEvent.change(screen.getByLabelText('Recipient name'), {
      target: { value: ' Ada Owner ' },
    });
    fireEvent.change(screen.getByLabelText('Address line 1'), {
      target: { value: ' 1 Gem Street ' },
    });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: ' Geneva ' } });
    fireEvent.change(screen.getByLabelText('Postal code'), { target: { value: ' 1201 ' } });
    fireEvent.change(screen.getByLabelText('Country'), {
      target: { value: ' Switzerland ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request redemption' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Complete insured-delivery details are required',
    );
    expect(mocks.createCommitment).toHaveBeenCalledWith(
      expect.objectContaining({
        fulfillmentMethod: 'insured_delivery',
        fulfillmentDetails: {
          recipientName: 'Ada Owner',
          addressLine1: '1 Gem Street',
          city: 'Geneva',
          postalCode: '1201',
          country: 'Switzerland',
        },
      }),
    );
    expect(mocks.requestRedemption).not.toHaveBeenCalled();
    expect(screen.queryByText('Redemption request recorded')).not.toBeInTheDocument();
  });

  it('does not show a redemption receipt when the chain confirms but backend persistence cannot be verified', async () => {
    mocks.getWorkflow.mockResolvedValueOnce(null);
    render(<RedeemModal gem={gem} open onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Preferred pickup location'), {
      target: { value: 'Zurich vault' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request redemption' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'chain transaction confirmed, but the fulfillment record is not confirmed yet',
    );
    expect(screen.queryByText('Redemption request recorded')).not.toBeInTheDocument();
  });
});

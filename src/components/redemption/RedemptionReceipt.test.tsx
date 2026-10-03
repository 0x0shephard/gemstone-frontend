import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RedemptionReceipt, RedemptionReceipts } from './RedemptionReceipt';
import type { RedemptionWorkflow } from '@/services/offchain/redemptions';
import type { Redemption } from '@/services/types';

const requestHash = `0x${'a'.repeat(64)}` as const;
const transactionHash = `0x${'b'.repeat(64)}` as const;
const workflow: RedemptionWorkflow = {
  workflowId: 'request-123',
  tokenId: '42',
  method: 'insured_delivery',
  status: 'committed',
  requestHash,
  transactionHash: null,
  createdAt: '2026-10-02T12:00:00.000Z',
};

describe('RedemptionReceipt', () => {
  it('does not call a backend-only commitment a completed request', () => {
    render(<RedemptionReceipt workflow={workflow} />);
    expect(screen.getByText('Fulfillment details saved')).toBeInTheDocument();
    expect(screen.getByText('Details saved · awaiting chain reconciliation')).toBeInTheDocument();
    expect(screen.queryByText('Redemption request recorded')).not.toBeInTheDocument();
  });

  it('shows the request id, commitment, status and chain transaction after both sides match', () => {
    const redemption = {
      workflowId: `onchain-${requestHash}`,
      tokenId: 42n,
      requestHash,
      transactionHash,
    } as Redemption;
    render(<RedemptionReceipts workflows={[workflow]} redemptions={[redemption]} />);

    expect(screen.getByText('Redemption request recorded')).toBeInTheDocument();
    expect(screen.getByText('Chain confirmed · backend indexing in progress')).toBeInTheDocument();
    expect(screen.getByText('request-123')).toBeInTheDocument();
    expect(screen.getByText(requestHash)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /transaction/i })).toHaveAttribute(
      'href',
      expect.stringContaining(transactionHash),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listLimit: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock('./invoke', () => ({
  requireClient: () => ({
    from: () => ({
      select: () => ({
        order: () => ({ limit: mocks.listLimit }),
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  }),
}));

import {
  getRedemptionWorkflow,
  listRedemptionWorkflows,
  redemptionFulfillmentDetails,
  redemptionFulfillmentIsValid,
} from './redemptions';

const blank = {
  pickupLocation: '',
  recipientName: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
};

const row = {
  id: 'request-123',
  token_id: 42,
  fulfillment_method: 'insured_delivery' as const,
  status: 'onchain_requested' as const,
  request_hash: `0x${'a'.repeat(64)}` as const,
  transaction_hash: `0x${'b'.repeat(64)}` as const,
  created_at: '2026-10-02T12:00:00.000Z',
};

describe('redemption fulfillment payloads', () => {
  it('sends only a trimmed pickup location for pickup', () => {
    const form = { ...blank, pickupLocation: '  Zurich vault  ', recipientName: 'ignored' };
    expect(redemptionFulfillmentDetails('pickup', form)).toEqual({
      pickupLocation: 'Zurich vault',
    });
    expect(redemptionFulfillmentIsValid('pickup', form)).toBe(true);
  });

  it('sends the insured-delivery shape with optional blank fields omitted', () => {
    const form = {
      ...blank,
      recipientName: '  Ada Owner ',
      addressLine1: ' 1 Gem Street ',
      city: ' Geneva ',
      postalCode: ' 1201 ',
      country: ' Switzerland ',
    };
    expect(redemptionFulfillmentDetails('insured_delivery', form)).toEqual({
      recipientName: 'Ada Owner',
      addressLine1: '1 Gem Street',
      city: 'Geneva',
      postalCode: '1201',
      country: 'Switzerland',
    });
    expect(redemptionFulfillmentIsValid('insured_delivery', form)).toBe(true);
    expect(redemptionFulfillmentIsValid('insured_delivery', { ...form, postalCode: '   ' })).toBe(
      false,
    );
  });
});

describe('redemption workflow recovery', () => {
  beforeEach(() => {
    mocks.listLimit.mockReset();
    mocks.maybeSingle.mockReset();
  });

  it('loads durable receipts after a reload', async () => {
    mocks.listLimit.mockResolvedValue({ data: [row], error: null });
    await expect(listRedemptionWorkflows()).resolves.toEqual([
      {
        workflowId: row.id,
        tokenId: '42',
        method: row.fulfillment_method,
        status: row.status,
        requestHash: row.request_hash,
        transactionHash: row.transaction_hash,
        createdAt: row.created_at,
      },
    ]);
  });

  it('re-reads one persisted workflow before showing success', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: row, error: null });
    await expect(getRedemptionWorkflow(row.id)).resolves.toMatchObject({
      workflowId: row.id,
      status: 'onchain_requested',
      requestHash: row.request_hash,
    });
  });
});

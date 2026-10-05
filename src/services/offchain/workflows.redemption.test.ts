import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('./invoke', () => ({ invokeEdgeFunction: invoke }));

import { createRedemptionCommitment } from './workflows';

describe('createRedemptionCommitment', () => {
  beforeEach(() => invoke.mockReset());

  it.each([
    ['pickup', { pickupLocation: 'Zurich vault' }],
    [
      'insured_delivery',
      {
        recipientName: 'Ada Owner',
        addressLine1: '1 Gem Street',
        city: 'Geneva',
        postalCode: '1201',
        country: 'Switzerland',
      },
    ],
  ] as const)('sends the %s payload with exact bigint strings', async (method, details) => {
    invoke.mockResolvedValue({
      workflowId: 'request-123',
      requestHash: `0x${'a'.repeat(64)}`,
    });
    await createRedemptionCommitment({
      wallet: '0x1111111111111111111111111111111111111111',
      gemId: 7n,
      tokenId: 42n,
      fulfillmentMethod: method,
      fulfillmentDetails: details,
      clientRequestId: '11111111-1111-4111-8111-111111111111',
    });
    expect(invoke).toHaveBeenCalledWith('v1-redemption-commitment', {
      wallet: '0x1111111111111111111111111111111111111111',
      gemId: '7',
      tokenId: '42',
      fulfillmentMethod: method,
      fulfillmentDetails: details,
      clientRequestId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('surfaces the insured-delivery server explanation instead of false success', async () => {
    invoke.mockImplementationOnce(async () => {
      throw new Error('Complete insured-delivery details are required');
    });
    await expect(
      createRedemptionCommitment({
        wallet: '0x1111111111111111111111111111111111111111',
        gemId: 7n,
        tokenId: 42n,
        fulfillmentMethod: 'insured_delivery',
        fulfillmentDetails: { recipientName: 'Ada Owner' },
        clientRequestId: '11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toThrow('Complete insured-delivery details are required');
  });
});

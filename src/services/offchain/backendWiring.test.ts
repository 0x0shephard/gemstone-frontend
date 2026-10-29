import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('./invoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./invoke')>()),
  invokeEdgeFunction: mocks.invoke,
  requireClient: () => {
    throw new Error('not used here');
  },
}));

import { EdgeFunctionError } from './invoke';
import { rejectSubmission } from './verification';
import { activateSellerGem, exactUsdBaseUnits } from './workflows';
import { KYC_UNAVAILABLE_MESSAGE, startKycSession } from './kycSession';
import { kycButtonLabel } from '@/components/kyc/KycVerifyButton';
import {
  eventPresentation,
  sellerLifecycleStages,
} from '@/components/operations/lifecyclePresentation';

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe('gem lab rejection', () => {
  it('goes through the versioned gem-lab workflow, not the retired grade endpoint', async () => {
    mocks.invoke.mockResolvedValue({ submissionId: 's-1', status: 'rejected' });

    await rejectSubmission({
      submissionId: 's-1',
      reason: '  Certificate does not match the stone  ',
      expectedVersion: 4,
      idempotencyKey: 'key-1',
    });

    expect(mocks.invoke).toHaveBeenCalledWith('v1-gemlab-workflow', {
      action: 'reject',
      submissionId: 's-1',
      reason: 'Certificate does not match the stone',
      idempotencyKey: 'key-1',
      expectedVersion: 4,
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith('v1-verification-grade', expect.anything());
  });

  it('refuses a reason the server would refuse, without calling it', async () => {
    await expect(
      rejectSubmission({
        submissionId: 's',
        reason: 'no',
        expectedVersion: 0,
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/10 to 2000 characters/);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('shows a rejected submission as stopped at the lab, with its reason', () => {
    const event = {
      id: 'e-2',
      sequence: 2,
      type: 'gem_rejected',
      fromState: 'awaiting_grading',
      toState: 'rejected',
      occurredAt: '2026-10-30T10:00:00.000Z',
      payload: { reason: 'Synthetic stone' },
    };
    const workflow = {
      workflowId: 'w',
      submissionId: 's',
      state: 'rejected',
      version: 2,
      legacyBaseline: false,
      updatedAt: event.occurredAt,
      events: [event],
      nextActions: [],
    };

    const stages = sellerLifecycleStages(workflow);
    expect(stages.map((stage) => stage.key)).toEqual(['submitted', 'rejected']);
    expect(stages[1]).toMatchObject({
      state: 'attention',
      label: 'Rejected by gem lab',
      detail: 'Synthetic stone',
      occurredAt: event.occurredAt,
    });
    expect(eventPresentation([event])[0]).toMatchObject({
      label: 'Rejected by gem lab',
      detail: 'Synthetic stone',
    });
  });
});

describe('seller activation status', () => {
  it("reports the server's 409 as an explanation, not a failure", async () => {
    mocks.invoke.mockRejectedValue(
      new EdgeFunctionError(
        'v1-seller-activate',
        'Digital Carat starts protocol activation after the bank records receipt of your stone; no action is needed from you',
        409,
      ),
    );
    await expect(activateSellerGem('s-1')).resolves.toEqual({
      waiting: expect.stringMatching(/no action is needed from you/),
    });
  });

  it('still fails on a real error', async () => {
    mocks.invoke.mockRejectedValue(new EdgeFunctionError('v1-seller-activate', 'boom', 500));
    await expect(activateSellerGem('s-1')).rejects.toThrow('boom');
  });
});

describe('identity verification', () => {
  it('labels the button by status and hides it once verified or on hold', () => {
    expect(kycButtonLabel('not_started')).toBe('Verify identity');
    expect(kycButtonLabel('rejected')).toBe('Verify identity');
    expect(kycButtonLabel('pending')).toBe('Continue verification');
    expect(kycButtonLabel('approved')).toBeUndefined();
    expect(kycButtonLabel('on_hold')).toBeUndefined();
  });

  it('opens a session with a refreshing token', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ token: 'first', expiresIn: 600 })
      .mockResolvedValueOnce({ token: 'second', expiresIn: 600 });
    const session = await startKycSession();
    expect(session.accessToken).toBe('first');
    expect(session.expiresAt).toBeGreaterThan(Date.now());
    await expect(session.refreshToken()).resolves.toBe('second');
    expect(mocks.invoke).toHaveBeenCalledWith('v1-sumsub-token');
  });

  it('says verification is not available yet when the provider is unconfigured (503)', async () => {
    mocks.invoke.mockRejectedValue(
      new EdgeFunctionError('v1-sumsub-token', 'Identity verification is not configured', 503),
    );
    await expect(startKycSession()).rejects.toThrow(KYC_UNAVAILABLE_MESSAGE);
  });
});

describe('exact valuations', () => {
  it('parses a text-cast numeric(78,0) exactly', () => {
    expect(exactUsdBaseUnits('2363000000000000000000')).toBe(2_363_000_000_000_000_000_000n);
    expect(exactUsdBaseUnits(null)).toBeUndefined();
  });

  it('drops a value that arrived as a lossy JSON number', () => {
    expect(exactUsdBaseUnits(2.363e21)).toBeUndefined();
    expect(exactUsdBaseUnits('2.363e+21')).toBeUndefined();
  });
});

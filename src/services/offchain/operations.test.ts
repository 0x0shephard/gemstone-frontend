import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./invoke', () => ({ invokeEdgeFunction: vi.fn() }));

import { invokeEdgeFunction } from './invoke';
import {
  authorizeRedemptionOwner,
  clearOperationIdempotencyKey,
  loadOperationsAccess,
  loadRedemptionTracker,
  operationIdempotencyKey,
  prepareOwnerAuthorization,
} from './operations';

describe('operations client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('does not reveal a staff route when the capability endpoint denies access', async () => {
    vi.mocked(invokeEdgeFunction).mockRejectedValueOnce(new Error('Not found'));
    await expect(loadOperationsAccess()).resolves.toBeNull();
  });

  it('keeps one idempotency key across reload-style retries until success is reconciled', () => {
    const first = operationIdempotencyKey('bank:submission-1:receipt');
    const retry = operationIdempotencyKey('bank:submission-1:receipt');
    expect(retry).toBe(first);

    clearOperationIdempotencyKey('bank:submission-1:receipt');
    expect(operationIdempotencyKey('bank:submission-1:receipt')).not.toBe(first);
  });

  it('does not share mutation keys between separate workflows', () => {
    expect(operationIdempotencyKey('bank:submission-1:receipt')).not.toBe(
      operationIdempotencyKey('bank:submission-2:receipt'),
    );
  });

  it('uses a server-prepared single-use challenge before owner authorization', async () => {
    vi.mocked(invokeEdgeFunction)
      .mockResolvedValueOnce({
        challenge: {
          id: 'challenge-id',
          message: 'Sign this exact request-bound message',
          expiresAt: '2026-10-03T12:05:00.000Z',
        },
      })
      .mockResolvedValueOnce({ authorization: { nonce: `0x${'1'.repeat(64)}` } });

    await prepareOwnerAuthorization({
      requestId: 'request-id',
      code: '482193',
      ownerWallet: '0x1111111111111111111111111111111111111111',
      expectedVersion: 7,
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    });
    await authorizeRedemptionOwner({
      requestId: 'request-id',
      challengeId: 'challenge-id',
      code: '482193',
      ownerWallet: '0x1111111111111111111111111111111111111111',
      ownerSignature: `0x${'2'.repeat(130)}`,
      expectedVersion: 7,
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
    });

    expect(invokeEdgeFunction).toHaveBeenNthCalledWith(1, 'v1-redemption-lifecycle', {
      action: 'prepare_owner_authorization',
      requestId: 'request-id',
      code: '482193',
      ownerWallet: '0x1111111111111111111111111111111111111111',
      expectedVersion: 7,
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    });
    expect(invokeEdgeFunction).toHaveBeenNthCalledWith(
      2,
      'v1-redemption-lifecycle',
      expect.objectContaining({
        action: 'authorize_owner',
        challengeId: 'challenge-id',
        expectedVersion: 7,
      }),
    );
  });

  it('preserves bank-safe proxy nomination and recovery metadata from tracker detail', async () => {
    const proxyNomination = {
      id: 'nomination-id',
      proxyName: 'Named Proxy',
      proxyWallet: '0x2222222222222222222222222222222222222222',
      collectorCommitment: `0x${'2'.repeat(64)}`,
      identityEvidence: {
        id: 'evidence-id',
        mimeType: 'image/jpeg',
        sha256: 'abc',
        downloadUrl: 'https://example.test/signed',
        expiresIn: 300,
      },
      createdAt: '2026-10-04T00:00:00.000Z',
    };
    const recovery = {
      proposalId: 'proposal-id',
      proposalHash: `0x${'3'.repeat(64)}`,
      evidenceDigest: `0x${'4'.repeat(64)}`,
      executeAfter: '2026-10-11T00:00:00.000Z',
      requiredApprovals: 2,
      approvals: 1,
      state: 'proposed',
    };
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      request: {
        id: 'request-id',
        tokenId: '42',
        method: 'pickup',
        status: 'bank_received',
        version: 4,
        steps: [],
      },
      events: [],
      evidence: [],
      capabilities: ['record_pickup_handover'],
      proxyNomination,
      recovery,
    });

    await expect(loadRedemptionTracker('request-id', 'bank-org')).resolves.toEqual(
      expect.objectContaining({ proxyNomination, recovery }),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('./invoke', () => {
  class EdgeFunctionOutcomeUnknownError extends Error {
    constructor(readonly functionName: string) {
      super(`Outcome unknown: ${functionName}`);
    }
  }
  return {
    EdgeFunctionOutcomeUnknownError,
    invokeEdgeFunction: (...args: unknown[]) => invokeMock(...args),
    requireClient: vi.fn(),
  };
});

const { EdgeFunctionOutcomeUnknownError } = await import('./invoke');
const { createGiftCard } = await import('./gift');
const { inspectGiftPreparationIntent, saveGiftPreparationIntent } = await import('./giftHandoff');

describe('gift preparation timeout recovery', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    sessionStorage.clear();
  });

  it('recovers the original request and code on remount after two unknown outcomes', async () => {
    const scope = { chainId: 11155111, account: '0xABCD', gemId: '19' };
    const intent = {
      ...scope,
      clientRequestId: '9d2dcc75-f091-4732-a6c5-ce74b2491430',
      code: 'ABCD1234EFGH5678',
      payload: {
        tokenId: '19',
        recipientEmail: 'recipient@example.com',
        recipientName: 'Recipient',
        message: 'Original message',
        template: 'classic',
      },
    };
    saveGiftPreparationIntent(intent);
    const firstMount = inspectGiftPreparationIntent(scope)!;
    invokeMock
      .mockRejectedValueOnce(new EdgeFunctionOutcomeUnknownError('v1-gift-create'))
      .mockRejectedValueOnce(new EdgeFunctionOutcomeUnknownError('v1-gift-create'));

    await expect(
      createGiftCard(
        {
          tokenId: BigInt(firstMount.payload.tokenId),
          recipientEmail: firstMount.payload.recipientEmail,
          recipientName: firstMount.payload.recipientName,
          message: firstMount.payload.message,
          template: 'classic',
        },
        firstMount,
      ),
    ).rejects.toBeInstanceOf(EdgeFunctionOutcomeUnknownError);

    const recoveredCard = {
      giftId: '9ba45877-a549-4ca7-a3ca-8892e0e87dd4',
      code: intent.code,
      displayCode: 'ABCD-1234-EFGH-5678',
      expiresAt: '2999-01-01T00:00:00.000Z',
      tokenId: '19',
      gemId: '19',
      escrowWallet: '0x1111111111111111111111111111111111111111',
      escrowed: false,
    } as const;
    invokeMock.mockResolvedValueOnce(recoveredCard);
    const remount = inspectGiftPreparationIntent(scope)!;
    await expect(
      createGiftCard(
        {
          tokenId: BigInt(remount.payload.tokenId),
          recipientEmail: remount.payload.recipientEmail,
          recipientName: remount.payload.recipientName,
          message: remount.payload.message,
          template: 'classic',
        },
        remount,
      ),
    ).resolves.toEqual(recoveredCard);

    expect(invokeMock).toHaveBeenCalledTimes(3);
    for (const [, body] of invokeMock.mock.calls) {
      expect(body).toMatchObject({
        clientRequestId: intent.clientRequestId,
        code: intent.code,
        recipientEmail: intent.payload.recipientEmail,
        message: intent.payload.message,
      });
    }
  });
});

describe('gift sender copy resend', () => {
  beforeEach(() => invokeMock.mockReset());

  it('asks the server to re-send the copy for this card and returns its outcome', async () => {
    const { resendGiftSenderCopy } = await import('./gift');
    invokeMock.mockResolvedValueOnce({ senderCopy: { status: 'sent' } });

    await expect(
      resendGiftSenderCopy({
        giftId: '9ba45877-a549-4ca7-a3ca-8892e0e87dd4',
        code: 'ABCD1234EFGH5678',
      }),
    ).resolves.toEqual({ status: 'sent' });
    expect(invokeMock).toHaveBeenCalledWith('v1-gift-create', {
      action: 'sender_copy',
      giftId: '9ba45877-a549-4ca7-a3ca-8892e0e87dd4',
      code: 'ABCD1234EFGH5678',
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearGiftPreparationIntent,
  clearGiftHandoff,
  inspectGiftPreparationIntent,
  inspectGiftHandoff,
  listGiftHandoffs,
  saveGiftPreparationIntent,
  saveGiftHandoff,
} from './giftHandoff';

const card = {
  giftId: '9ba45877-a549-4ca7-a3ca-8892e0e87dd4',
  code: 'ABCD1234EFGH5678',
  displayCode: 'ABCD-1234-EFGH-5678',
  expiresAt: '2999-01-01T00:00:00.000Z',
  tokenId: '19',
  gemId: '19',
  escrowWallet: '0x1111111111111111111111111111111111111111' as const,
  escrowed: false,
};

describe('gift handoff recovery', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  const scope = { chainId: 11155111, account: '0xABCD' };

  it('inspects a prepared gift without destructively consuming it', () => {
    saveGiftHandoff({
      ...scope,
      gemId: '19',
      card,
      recipientEmail: 'recipient@example.com',
      recipientName: 'Recipient',
      message: 'A gift',
      template: 'classic',
    });

    expect(inspectGiftHandoff({ ...scope, gemId: '19' })).toMatchObject({
      card,
      recipientEmail: 'recipient@example.com',
    });
    expect(inspectGiftHandoff({ ...scope, gemId: '19' })).toBeDefined();
  });

  it('isolates cards by chain, account and gift id', () => {
    saveGiftHandoff({
      ...scope,
      gemId: '19',
      card,
      recipientEmail: 'recipient@example.com',
      recipientName: '',
      message: '',
      template: 'classic',
    });
    saveGiftHandoff({
      chainId: 1,
      account: scope.account,
      gemId: '20',
      card: { ...card, giftId: '270cc009-a148-4366-82cf-3105656629c2', gemId: '20' },
      recipientEmail: 'other@example.com',
      recipientName: '',
      message: '',
      template: 'noir',
    });

    expect(listGiftHandoffs(scope)).toHaveLength(1);
    expect(listGiftHandoffs({ ...scope, account: '0x9999' })).toHaveLength(0);
    expect(listGiftHandoffs({ ...scope, chainId: 1 })).toHaveLength(1);
  });

  it('can explicitly clear a completed handoff', () => {
    saveGiftHandoff({
      ...scope,
      gemId: '19',
      card: { ...card, escrowed: true },
      recipientEmail: 'recipient@example.com',
      recipientName: '',
      message: '',
      template: 'noir',
    });
    clearGiftHandoff({ ...scope, giftId: card.giftId });
    expect(inspectGiftHandoff({ ...scope, gemId: '19' })).toBeUndefined();
  });

  it('retains an activated card across remounts until explicit acknowledgement', () => {
    const activated = { ...card, escrowed: true };
    saveGiftHandoff({
      ...scope,
      gemId: '19',
      card: activated,
      recipientEmail: 'recipient@example.com',
      recipientName: 'Recipient',
      message: 'A gift',
      template: 'classic',
      escrowTxHash: `0x${'a'.repeat(64)}`,
    });

    expect(inspectGiftHandoff({ ...scope, giftId: card.giftId })?.card).toEqual(activated);
    expect(inspectGiftHandoff({ ...scope, giftId: card.giftId })?.card).toEqual(activated);
  });

  it('reuses the same preparation id and code after consecutive uncertain calls', () => {
    const intent = {
      ...scope,
      gemId: '19',
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

    expect(inspectGiftPreparationIntent(intent)).toMatchObject({
      clientRequestId: intent.clientRequestId,
      code: intent.code,
      payload: intent.payload,
    });
    expect(inspectGiftPreparationIntent(intent)).toMatchObject({
      clientRequestId: intent.clientRequestId,
      code: intent.code,
      payload: intent.payload,
    });

    clearGiftPreparationIntent(intent);
    expect(inspectGiftPreparationIntent(intent)).toBeUndefined();
  });

  it('restores the original form and secret on remount without manual re-entry', () => {
    const intent = {
      ...scope,
      gemId: '19',
      clientRequestId: '9d2dcc75-f091-4732-a6c5-ce74b2491430',
      code: 'ABCD1234EFGH5678',
      payload: {
        tokenId: '19',
        recipientEmail: 'recipient@example.com',
        recipientName: 'Recipient',
        message: 'Original message',
        template: 'celebration',
      },
    };
    saveGiftPreparationIntent(intent);
    const remountScope = { ...scope, gemId: '19' };
    expect(inspectGiftPreparationIntent(remountScope)).toMatchObject({
      clientRequestId: intent.clientRequestId,
      code: intent.code,
      payload: intent.payload,
    });
    expect(inspectGiftPreparationIntent(remountScope)?.payload.message).toBe('Original message');
  });

  it('expires the secret after a bounded recovery window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T00:00:00Z'));
    saveGiftHandoff({
      ...scope,
      gemId: '19',
      card,
      recipientEmail: 'recipient@example.com',
      recipientName: '',
      message: '',
      template: 'classic',
    });
    vi.advanceTimersByTime(24 * 60 * 60 * 1_000 + 1);
    expect(inspectGiftHandoff({ ...scope, gemId: '19' })).toBeUndefined();
  });
});

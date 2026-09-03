import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGiftHandoff, saveGiftHandoff, takeGiftHandoff } from './giftHandoff';

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

  it('restores a prepared mobile gift including the recipient email once', () => {
    saveGiftHandoff({
      gemId: '19',
      card,
      recipientEmail: 'recipient@example.com',
      recipientName: 'Recipient',
      message: 'A gift',
      template: 'classic',
    });

    expect(takeGiftHandoff('19')).toMatchObject({
      card,
      recipientEmail: 'recipient@example.com',
    });
    expect(takeGiftHandoff('19')).toBeUndefined();
  });

  it('can explicitly clear a completed handoff', () => {
    saveGiftHandoff({
      gemId: '19',
      card: { ...card, escrowed: true },
      recipientEmail: 'recipient@example.com',
      recipientName: '',
      message: '',
      template: 'noir',
    });
    clearGiftHandoff();
    expect(takeGiftHandoff('19')).toBeUndefined();
  });
});

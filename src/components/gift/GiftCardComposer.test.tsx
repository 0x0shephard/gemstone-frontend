import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DecoratedGem } from '@/services/types';

const giftMock = vi.hoisted(() => ({
  confirmGiftCardEscrow: vi.fn(),
  createGiftCard: vi.fn(),
  listGiftCards: vi.fn(),
  resendGiftSenderCopy: vi.fn(),
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    linkedWallet: '0x00000000000000000000000000000000000000aa',
    user: { id: 'sender-user' },
  }),
}));
vi.mock('@/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/env')>();
  return { ...actual, env: { ...actual.env, chainId: 11155111 } };
});
vi.mock('@/services', () => ({ dataService: { transferToken: vi.fn() } }));
vi.mock('@/components/modals/parts', () => ({ ModalGemHeader: () => null }));
vi.mock('@/components/tx/TxButton', () => ({ TxButton: () => null }));
vi.mock('./GiftCardArt', () => ({
  CARD_HEIGHT: 100,
  CARD_WIDTH: 160,
  GIFT_TEMPLATES: ['classic'],
  GiftCardArt: () => <svg />,
  templateLabel: () => 'Classic',
}));
vi.mock('@/lib/cardExport', () => ({
  cardAsPngBase64: vi.fn(),
  downloadCardPng: vi.fn(),
  downloadCardSvg: vi.fn(),
  inlineImage: vi.fn(() => Promise.resolve(undefined)),
  printCard: vi.fn(),
}));
vi.mock('@/services/offchain/canva', () => ({
  exportCardToCanva: vi.fn(),
  needsCanvaConnection: vi.fn(),
  startCanvaAuthorization: vi.fn(),
}));
vi.mock('@/services/offchain/gift', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/offchain/gift')>()),
  confirmGiftCardEscrow: giftMock.confirmGiftCardEscrow,
  createGiftCard: giftMock.createGiftCard,
  listGiftCards: giftMock.listGiftCards,
  resendGiftSenderCopy: giftMock.resendGiftSenderCopy,
}));

import { GiftCardComposer } from './GiftCardComposer';
import {
  inspectGiftHandoff,
  inspectGiftPreparationIntent,
  saveGiftHandoff,
} from '@/services/offchain/giftHandoff';

const account = '0x00000000000000000000000000000000000000aa';
const gem = { gemId: 19n, tokenId: 19n, name: 'Ruby', displayId: 'DC-19' } as DecoratedGem;
const scope = { chainId: 11155111, account, gemId: '19' };

function renderComposer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GiftCardComposer gem={gem} open onClose={vi.fn()} onBack={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('GiftCardComposer', () => {
  beforeEach(() => {
    sessionStorage.clear();
    giftMock.createGiftCard.mockReset();
    giftMock.confirmGiftCardEscrow.mockReset();
    giftMock.resendGiftSenderCopy.mockReset();
    giftMock.listGiftCards.mockReset().mockResolvedValue([]);
  });

  it('starts a fresh gift when the saved card was cancelled elsewhere', async () => {
    const giftId = '5f0c2b0e-0d2a-4a51-9b0e-6a2f4f1f9c11';
    saveGiftHandoff({
      ...scope,
      card: {
        giftId,
        code: 'OLDC0DE123456789',
        displayCode: 'OLDC-0DE1-2345-6789',
        expiresAt: '2999-01-01T00:00:00.000Z',
        tokenId: '19',
        gemId: '19',
        escrowWallet: '0x1111111111111111111111111111111111111111',
        escrowed: true,
      },
      recipientEmail: 'friend@example.com',
      recipientName: '',
      message: '',
      template: 'classic',
    });
    giftMock.listGiftCards.mockResolvedValue([{ id: giftId, status: 'cancelled' }]);
    renderComposer();

    expect(await screen.findByLabelText('Recipient email')).toBeInTheDocument();
    expect(screen.queryByText('Gift card ready')).not.toBeInTheDocument();
    expect(inspectGiftHandoff({ ...scope, giftId })).toBeUndefined();
  });

  it('drops a definitely rejected preparation so the next attempt uses the edited form', async () => {
    giftMock.createGiftCard.mockRejectedValueOnce(
      new Error('This token already has a live gift card'),
    );
    renderComposer();

    await userEvent.type(screen.getByLabelText('Recipient email'), 'first@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Continue with gift card' }));

    expect(await screen.findByText('This token already has a live gift card')).toBeInTheDocument();
    expect(inspectGiftPreparationIntent(scope)).toBeUndefined();

    giftMock.createGiftCard.mockReturnValueOnce(new Promise(() => {}));
    const emailField = screen.getByLabelText('Recipient email');
    await userEvent.clear(emailField);
    await userEvent.type(emailField, 'second@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Continue with gift card' }));

    const [retryInput, retryKey] = giftMock.createGiftCard.mock.calls[1];
    const [firstInput, firstKey] = giftMock.createGiftCard.mock.calls[0];
    expect(firstInput.recipientEmail).toBe('first@example.com');
    expect(retryInput.recipientEmail).toBe('second@example.com');
    expect(retryKey.clientRequestId).not.toBe(firstKey.clientRequestId);
  });

  it('says when the sender copy failed and lets the sender email it again', async () => {
    saveGiftHandoff({
      ...scope,
      card: {
        giftId: '9ba45877-a549-4ca7-a3ca-8892e0e87dd4',
        code: 'ABCD1234EFGH5678',
        displayCode: 'ABCD-1234-EFGH-5678',
        expiresAt: '2999-01-01T00:00:00.000Z',
        tokenId: '19',
        gemId: '19',
        escrowWallet: '0x1111111111111111111111111111111111111111',
        escrowed: true,
        senderCopy: { status: 'failed', reason: 'Email delivery failed: domain not verified' },
      },
      recipientEmail: 'friend@example.com',
      recipientName: '',
      message: '',
      template: 'classic',
    });
    giftMock.resendGiftSenderCopy.mockResolvedValueOnce({ status: 'sent' });
    renderComposer();

    expect(
      screen.getByText(/Your printable copy was not emailed: Email delivery failed/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Email my copy' }));

    expect(
      await screen.findByText(/A printable QR copy was emailed to your account/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email my copy' })).not.toBeInTheDocument();
  });

  it.each([
    [true, 0],
    [false, 1],
  ])(
    'with awaitingTransfer=%s, auto-confirms custody %i times on reopen',
    (awaitingTransfer, calls) => {
      giftMock.confirmGiftCardEscrow.mockReturnValue(new Promise(() => {}));
      saveGiftHandoff({
        ...scope,
        card: {
          giftId: '99e5b014-a65b-4a6a-9199-e9871c19f5dc',
          code: 'NEWC0DE123456789',
          displayCode: 'NEWC-0DE1-2345-6789',
          expiresAt: '2999-01-01T00:00:00.000Z',
          tokenId: '19',
          gemId: '19',
          escrowWallet: '0x1111111111111111111111111111111111111111',
          escrowed: false,
        },
        recipientEmail: 'friend@example.com',
        recipientName: '',
        message: '',
        template: 'classic',
        awaitingTransfer,
      });
      renderComposer();

      expect(giftMock.confirmGiftCardEscrow).toHaveBeenCalledTimes(calls);
      expect(screen.getByText('Secure in escrow')).toBeInTheDocument();
    },
  );
});

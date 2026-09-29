import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GiftCardRow } from '@/services/offchain/gift';

const account = '0x00000000000000000000000000000000000000aa';
const giftMock = vi.hoisted(() => ({ list: vi.fn(), resume: vi.fn() }));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'profile-1' }, linkedWallet: account }),
}));
vi.mock('@/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/env')>();
  return { ...actual, env: { ...actual.env, chainId: 11155111 } };
});
vi.mock('@/services', () => ({
  dataService: { getTokenApprovals: vi.fn(() => Promise.resolve({})) },
}));
vi.mock('@/hooks/useData', () => ({
  useGem: (id: string) => ({ data: { gemId: BigInt(id), tokenId: 24n, name: 'Sapphire' } }),
}));
vi.mock('./GiftCardComposer', () => ({
  GiftCardComposer: ({ gem }: { gem: { name: string } }) => <div>Composer for {gem.name}</div>,
}));
vi.mock('@/services/offchain/gift', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/offchain/gift')>()),
  listGiftCards: giftMock.list,
  resumeGiftCard: giftMock.resume,
}));

import { GiftCardList } from './GiftCardList';
import { inspectGiftHandoff } from '@/services/offchain/giftHandoff';

const pendingCard: GiftCardRow = {
  id: '99e5b014-a65b-4a6a-9199-e9871c19f5dc',
  token_id: '24',
  gem_id: '20',
  recipient_email: 'friend@example.com',
  recipient_name: 'Friend',
  message: 'For you',
  template: 'classic',
  status: 'pending_escrow',
  custody_mode: 'operator_escrow',
  escrow_wallet: '0xcc624ffa5df1f3f4b30aa8abd30186a86254f406',
  escrowed_at: null,
  escrow_tx_hash: null,
  claimed_wallet: null,
  claimed_at: null,
  claim_tx_hash: null,
  expires_at: '2999-01-01T00:00:00.000Z',
  created_at: '2026-09-22T10:19:50.962Z',
};

function resumed(custody: 'escrow' | 'sender') {
  return {
    giftId: pendingCard.id,
    code: 'NEWC0DE123456789',
    displayCode: 'NEWC-0DE1-2345-6789',
    expiresAt: pendingCard.expires_at,
    tokenId: '24',
    gemId: '20',
    escrowWallet: '0xcC624ffa5dF1f3F4b30aA8aBd30186a86254f406',
    escrowed: false,
    custody,
  };
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GiftCardList owned={[]} />
    </QueryClientProvider>,
  );
}

describe('GiftCardList resume', () => {
  beforeEach(() => {
    sessionStorage.clear();
    giftMock.list.mockReset().mockResolvedValue([pendingCard]);
    giftMock.resume.mockReset();
  });

  it('finishes a pending card whose code this tab never held, even with the token in escrow', async () => {
    giftMock.resume.mockResolvedValueOnce(resumed('escrow'));
    renderList();

    await userEvent.click(await screen.findByRole('button', { name: 'Finish gift card' }));

    expect(giftMock.resume).toHaveBeenCalledWith(pendingCard.id);
    expect(await screen.findByText('Composer for Sapphire')).toBeInTheDocument();
    const handoff = inspectGiftHandoff({ chainId: 11155111, account, giftId: pendingCard.id });
    expect(handoff?.card.code).toBe('NEWC0DE123456789');
    expect(handoff?.recipientEmail).toBe('friend@example.com');
    expect(handoff?.awaitingTransfer).toBe(false);
  });

  it('marks a resumed card as still needing its transfer when the sender holds the token', async () => {
    giftMock.resume.mockResolvedValueOnce(resumed('sender'));
    renderList();

    await userEvent.click(await screen.findByRole('button', { name: 'Finish gift card' }));

    await screen.findByText('Composer for Sapphire');
    expect(
      inspectGiftHandoff({ chainId: 11155111, account, giftId: pendingCard.id })?.awaitingTransfer,
    ).toBe(true);
  });
});

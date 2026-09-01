import { describe, expect, it } from 'vitest';
import { giftCardState, type GiftCardRow } from './gift';

function row(status: GiftCardRow['status'], expiresAt: string): GiftCardRow {
  return {
    id: 'gift',
    token_id: '1',
    gem_id: '1',
    recipient_email: 'recipient@example.com',
    recipient_name: null,
    message: null,
    template: 'classic',
    status,
    custody_mode: 'operator_escrow',
    escrow_wallet: '0x1111111111111111111111111111111111111111',
    escrowed_at: null,
    escrow_tx_hash: null,
    claimed_wallet: null,
    claimed_at: null,
    claim_tx_hash: null,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  };
}

describe('giftCardState', () => {
  it('keeps a prepared gift visibly pending before the NFT reaches escrow', () => {
    expect(giftCardState(row('pending_escrow', '2999-01-01T00:00:00.000Z'))).toBe('pending');
  });

  it('derives expiry only for active gifts', () => {
    expect(giftCardState(row('active', '2000-01-01T00:00:00.000Z'))).toBe('expired');
    expect(giftCardState(row('cancelled', '2000-01-01T00:00:00.000Z'))).toBe('cancelled');
  });
});

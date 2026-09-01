import { describe, expect, it } from 'vitest';
import type { DecoratedGem } from '@/services/types';
import { marketplaceParticipant } from './marketplaceProfiles';

const owner = '0x1111111111111111111111111111111111111111';
const seller = '0x2222222222222222222222222222222222222222';

function gem(overrides: Partial<DecoratedGem>): DecoratedGem {
  return {
    gemId: 1n,
    displayId: 'DGE-1',
    name: 'Ruby',
    type: 'ruby',
    typeLabel: 'Ruby',
    valueUsd: 1n,
    value: 1,
    carats: 1,
    reserve: 100,
    reserveBalanceUsd: 1n,
    reserveShortfallUsd: 0n,
    feeTier: 'Secondary marketplace',
    feePct: 2,
    custodyProvider: 'Vault',
    custodyCountry: 'PK',
    redeem: 'Eligible',
    color: '#fff',
    valueFmt: '$1',
    caratsFmt: '1 ct',
    thumb: '',
    reserveLabel: 'Funded',
    reserveColor: '#fff',
    funded: true,
    feeLabel: '2%',
    custodyLabel: 'Vault · PK',
    ...overrides,
  };
}

describe('marketplaceParticipant', () => {
  it('shows the listing seller instead of the Marketplace escrow owner', () => {
    expect(marketplaceParticipant(gem({ owner, listingSeller: seller }))).toEqual({
      address: seller,
      role: 'Seller',
    });
  });

  it('falls back from a minted owner to the primary seller', () => {
    expect(marketplaceParticipant(gem({ owner }))).toEqual({ address: owner, role: 'Owner' });
    expect(marketplaceParticipant(gem({ seller }))).toEqual({ address: seller, role: 'Seller' });
  });
});

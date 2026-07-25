import type { HowStep } from '@/services/types';

/**
 * Product education, not market data. Keep this independent from the selected
 * data adapter so switching between mock and chain mode cannot remove it.
 */
export const ownershipPathSteps: readonly HowStep[] = [
  {
    num: '01',
    title: 'Certify & vault',
    body: 'An expert reviews the stone and an approved custodian records its custody before activation.',
  },
  {
    num: '02',
    title: 'Fund reserve',
    body: 'A reserve is posted on-chain to back the asset. Minting stays blocked until it is fully funded.',
  },
  {
    num: '03',
    title: 'Mint & trade',
    body: 'The gem can be bought directly or at auction, then listed, offered, or swapped on-chain.',
  },
  {
    num: '04',
    title: 'Redeem or hold',
    body: 'Keep trading the token or request redemption. The NFT locks, then burns when the stone is released.',
  },
];

import type { HowStep } from '@/services/types';

/**
 * Product education, not market data. Keep this independent from the selected
 * data adapter so switching between mock and chain mode cannot remove it.
 */
export const ownershipPathSteps: readonly HowStep[] = [
  {
    num: '01',
    title: 'KYC, Gemological Review and Custody',
    body: 'After the seller completes KYC, an approved custodian receives the gemstone and a professional laboratory grades it against the Digital Carat valuation matrix.',
    points: [
      'The lab records the gemstone characteristics and approved valuation.',
      'An approved stone opens a 24-hour auction at that valuation.',
    ],
  },
  {
    num: '02',
    title: 'Auction and Minting',
    body: 'Auctions run in repeating 24-hour cycles. The highest qualifying bid wins when a cycle closes, and settlement mints the ERC-721 token to the winner.',
    points: [
      'The approved valuation is the auction floor.',
      'A cycle with no qualifying bid can reopen for another 24 hours.',
    ],
  },
  {
    num: '03',
    title: 'Trading the Token',
    body: 'A minted token can be listed at an owner-selected price. Other holders can buy it, make a timed offer, or propose a token-for-token swap.',
    points: [
      'Owners review offers and swaps from their portfolio.',
      'Completed activity remains available in portfolio history.',
    ],
  },
  {
    num: '04',
    title: 'Redemption',
    body: 'The token owner requests redemption, chooses collection or insured delivery, and confirms the fulfilment details. The token locks while the custodian prepares the gemstone.',
    points: [
      'The custodian confirms only after physical handover.',
      'Confirmation burns the token permanently and completes the claim.',
    ],
  },
  {
    num: '05',
    title: 'Payments',
    body: 'Payments use the assets enabled in the protocol registry. The current Sepolia deployment supports ETH and mock USDC, and every transaction shows the selected asset before signing.',
    points: [
      'Native ETH payments need no token approval.',
      'ERC-20 payments request approval before the transaction.',
    ],
  },
];

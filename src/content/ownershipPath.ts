import type { HowStep } from '@/services/types';

/**
 * Product education, not market data. Keep this independent from the selected
 * data adapter so switching between mock and chain mode cannot remove it.
 */
export const ownershipPathSteps: readonly HowStep[] = [
  {
    num: '01',
    title: 'Verification, Valuation and Custody',
    body: 'Every seller completes KYC to verify their identity and the legitimate sourcing of the gemstone.',
    points: [
      'Gemmological review: a professional laboratory independently assesses and records the gemstone characteristics.',
      'Valuation: the laboratory assessment establishes a proposed price for the seller to review and approve.',
      'Custodian vault: the approved gemstone moves into secure third-party custody before it is listed.',
    ],
  },
  {
    num: '02',
    title: 'Auction and Token Minting',
    body: 'The approved valuation becomes the gemstone auction floor. Auctions run in repeating 24-hour cycles and the highest qualifying bid wins.',
    points: [
      'If no qualifying bid is received, the auction can open for another 24-hour cycle.',
      'A successful auction mints a unique ERC-721 token on Ethereum to the winner.',
    ],
  },
  {
    num: '03',
    title: 'Trading the Token',
    body: 'Once minted, a Digital Carat token can be sold, held, or swapped through the marketplace and portfolio.',
    points: [
      'Sell: list the token at a chosen price. A qualifying bid starts a 24-hour auction and the highest bidder wins.',
      'Hold: keep the token in your portfolio and receive bids from other users.',
      'Swap: propose or receive exchanges with other token holders and respond through the swaps page.',
      'Each token keeps a transaction history that includes previous bids and swaps.',
    ],
  },
  {
    num: '04',
    title: 'Redeeming the Gemstone',
    body: 'Token holders can redeem the physical gemstone represented by their token at any time by selecting Redeem and confirming the fulfilment details.',
    points: [
      'The third-party custodian arranges collection or secure, insured delivery of the gemstone.',
      'Once handover is confirmed, the corresponding token is permanently burned.',
    ],
  },
  {
    num: '05',
    title: 'Payments',
    body: 'Digital Carat supports native ETH and registry-approved stablecoin payments. The current Sepolia deployment uses mock USDC for stablecoin testing.',
    points: [
      'Native ETH payments need no token approval.',
      'Stablecoin payments request an ERC-20 approval before the transaction.',
    ],
  },
];

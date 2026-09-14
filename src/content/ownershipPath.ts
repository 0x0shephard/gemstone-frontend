import type { HowStep } from '@/services/types';

/**
 * Product education, not market data. Keep this independent from the selected
 * data adapter so switching between mock and chain mode cannot remove it.
 */
export const ownershipPathSteps: readonly HowStep[] = [
  {
    num: '01',
    title: 'Verification, Valuation & Custody',
    body: '',
    sections: [
      {
        heading: 'SELLER Verification',
        body: 'Every seller completes a KYC process to verify their identity and the legitimate sourcing of the gemstone.',
      },
      {
        heading: 'GEMMOLOGICAL Review',
        body: 'The gemstone is sent to a professional gemmological laboratory, where its characteristics are independently assessed and recorded.',
      },
      {
        heading: 'VALUATION',
        body: 'Based on the laboratory assessment, a valuation and proposed price are established. The seller reviews and approves the price through the Digital Carat Platform.',
      },
      {
        heading: 'CUSTODIAN VAULT',
        body: 'Once approved, the gemstone is approved to a secure third-party custodian vault and listed on the market place.',
      },
    ],
  },
  {
    num: '02',
    title: 'Auction & Token Minting',
    body: 'The approved valuation becomes the gemstone’s auction floor price. Auctions run in 24H cycles. The highest bid above the floor price wins. If no qualifying bid is received, the auction automatically opens for another 24-hour cycle. Following a successful auction, the gemstone is represented by a unique ERC-721 token on Etheruem.',
  },
  {
    num: '03',
    title: 'Trading the Token',
    body: 'Once minted, Digital Carat Token can be traded on the marketplace. Token Holders can:',
    sections: [
      {
        heading: 'SELL',
        body: 'List their Token at a chosen price. The highest qualifying bid wins the auction.',
      },
      {
        heading: 'HOLD',
        body: 'Keep the Token in their Portfolio and receive bids from other users.',
      },
      {
        heading: 'SWAP',
        body: 'Propose or receive swaps with other token holders and accept or decline them directly through their portfolio.',
      },
      {
        body: 'Each token displays its transaction history, including previous bids and swaps.',
      },
    ],
  },
  {
    num: '04',
    title: 'Redemption the Gemstone',
    body: 'Token holders can redeem the physical gemstone represented by their token at anytime.',
    sections: [
      {
        body: 'Simply select “Redeem” and confirm the delivery details. The third-party custodian then arranges secure, insured delivery of the gemstone.',
      },
      {
        body: 'Once delivery is confirmed, the corresponding token is permanently burned, completing the redemption process..',
      },
    ],
  },
  {
    num: '05',
    title: 'Payments',
    body: 'Digital Carat supports ETH and USDT crypto-currency payments through the platform.',
  },
];

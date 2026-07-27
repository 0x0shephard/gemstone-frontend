import type { HowStep } from '@/services/types';

/**
 * Product education, not market data. Keep this independent from the selected
 * data adapter so switching between mock and chain mode cannot remove it.
 */
export const ownershipPathSteps: readonly HowStep[] = [
  {
    num: '01',
    title: 'KYC, Gemological Review and Custody',
    body: 'Once a seller that has complied with our KYC protocol proposes a stone for sale, the stone is evaluated by a professional gemologist that certifies it according to our gemstone valuation matrix. It is then deposited at the bank that confirms its custody and then is listed for minting on our platform.',
  },
  {
    num: '02',
    title: 'Minting NFTs',
    body: 'Minting a gemstone into an NFT happens by auction. At minting, part of the first sale value is stored as reserve on the NFT to cover vault fees.',
  },
  {
    num: '03',
    title: 'Trading NFTs',
    body: 'The owner of an NFT can list it on the Marketplace to be sold at auction, he can swap it for another NFT or offer it to someone special…',
  },
  {
    num: '04',
    title: 'Redemption Process',
    body: 'In case you want to redeem the gemstone of your NFT, activate the redeem my gemstone function and follow the steps. The gemstone will be sent to the pick-up location of your choice in Istanbul and the NFT will burn after the custodian actions gemstone delivered function on his end.',
  },
];

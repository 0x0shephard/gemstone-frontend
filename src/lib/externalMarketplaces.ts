import { arbitrum, base, mainnet, optimism, polygon } from 'wagmi/chains';

/**
 * OpenSea's chain slugs for item URLs, for the chains it lists. OpenSea retired
 * its testnet site, so Sepolia and other testnets have no OpenSea page.
 */
const OPENSEA_CHAIN_SLUG: Readonly<Record<number, string>> = {
  [arbitrum.id]: 'arbitrum',
  [mainnet.id]: 'ethereum',
  [base.id]: 'base',
  [optimism.id]: 'optimism',
  [polygon.id]: 'polygon',
};

/** The token's OpenSea page, or undefined where OpenSea does not list the chain. */
export function openSeaItemUrl(
  chainId: number,
  contract: string,
  tokenId: bigint,
): string | undefined {
  const slug = OPENSEA_CHAIN_SLUG[chainId];
  if (!slug) return undefined;
  return `https://opensea.io/item/${slug}/${contract.toLowerCase()}/${tokenId.toString()}`;
}

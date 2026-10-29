/**
 * What the configured chain means for permanent, public output.
 *
 * Deliberately free of `npm:` specifiers so it is unit-testable outside Deno.
 *
 * Metadata documents and valuation matrices are written once and can never be
 * corrected, so their wording must come from the chain they are written to, not
 * from whichever network the code was first written against. An unknown chain is
 * refused rather than guessed: a new production network calling itself a test
 * network forever is exactly the mistake this exists to prevent.
 */

export interface NetworkProfile {
  chainId: number;
  /** Stable identifier recorded inside committed documents. */
  slug: string;
  /** Real assets and real money: no test wording, no test-only pricing. */
  production: boolean;
}

const NETWORKS: Readonly<Record<number, Omit<NetworkProfile, 'chainId'>>> = {
  1: { slug: 'ethereum-mainnet', production: true },
  42161: { slug: 'arbitrum-one', production: true },
  // The slug Sepolia valuations were committed with. Changing it would change
  // the matrix hash every historical Sepolia valuation resolves to.
  11155111: { slug: 'ethereum-sepolia', production: false },
  421614: { slug: 'arbitrum-sepolia', production: false },
  31337: { slug: 'local-anvil', production: false },
};

/** Mirrors `configuredChain` in `chain.ts`, which defaults an unset value to Sepolia. */
export function configuredChainId(env: (name: string) => string | undefined): number {
  const chainId = Number(env('CHAIN_ID') ?? 11155111);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error('CHAIN_ID must be a positive integer');
  }
  return chainId;
}

export function networkProfile(chainId: number): NetworkProfile {
  const known = NETWORKS[chainId];
  if (!known) {
    throw new Error(
      `Chain ${chainId} has no network profile; add it to _shared/network.ts before publishing to it`,
    );
  }
  return { chainId, ...known };
}

/**
 * The exact description Sepolia documents were published with. Kept for that
 * chain only, so republishing an identical Sepolia document still produces the
 * identical bytes and therefore the identical CID.
 */
export const SEPOLIA_METADATA_DESCRIPTION =
  'Digital Carat Sepolia MVP gemstone submission with test-only automated valuation and custody activation.';

export const PRODUCTION_METADATA_DESCRIPTION =
  'A physical gemstone tokenised by Digital Carat. Its laboratory-graded attributes and approved ' +
  'valuation are committed on-chain, and the stone is held in custody until it is redeemed.';

export const TEST_NETWORK_METADATA_DESCRIPTION =
  'Digital Carat test-network gemstone record. Its valuation and custody exist for testing only ' +
  'and confer no claim to a physical stone.';

export function metadataDescription(chainId: number): string {
  const network = networkProfile(chainId);
  if (network.production) return PRODUCTION_METADATA_DESCRIPTION;
  if (chainId === 11155111) return SEPOLIA_METADATA_DESCRIPTION;
  return TEST_NETWORK_METADATA_DESCRIPTION;
}

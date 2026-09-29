import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { sepolia } from 'viem/chains';

const nftAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenGem(uint256 tokenId) view returns (uint256)',
]);

/** Reads straight from the local chain, so assertions never trust the UI's own view. */
export function chain(rpc: string, nft: string) {
  const client = createPublicClient({ chain: sepolia, transport: http(rpc) });
  return {
    ownerOf: (tokenId: bigint) =>
      client.readContract({
        address: nft as Address,
        abi: nftAbi,
        functionName: 'ownerOf',
        args: [tokenId],
      }),
    gemOf: (tokenId: bigint) =>
      client.readContract({
        address: nft as Address,
        abi: nftAbi,
        functionName: 'tokenGem',
        args: [tokenId],
      }),
    balanceOf: (owner: string) =>
      client.readContract({
        address: nft as Address,
        abi: nftAbi,
        functionName: 'balanceOf',
        args: [owner as Address],
      }),
  };
}

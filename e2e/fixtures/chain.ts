import { createPublicClient, encodeFunctionData, http, parseAbi, type Address } from 'viem';
import { sepolia } from 'viem/chains';

const nftAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenGem(uint256 tokenId) view returns (uint256)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function transferLocked(uint256 tokenId) view returns (bool)',
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
    /** Sends as `from` through anvil's unlocked dev account — "the wallet did it". */
    async transferAs(from: string, to: string, tokenId: bigint) {
      const data = encodeFunctionData({
        abi: nftAbi,
        functionName: 'safeTransferFrom',
        args: [from as Address, to as Address, tokenId],
      });
      const hash = await client.request({
        method: 'eth_sendTransaction' as never,
        params: [{ from, to: nft, data }] as never,
      });
      await client.waitForTransactionReceipt({ hash: hash as `0x${string}` });
    },
    locked: (tokenId: bigint) =>
      client.readContract({
        address: nft as Address,
        abi: nftAbi,
        functionName: 'transferLocked',
        args: [tokenId],
      }),
    /** Burned tokens revert on ownerOf. */
    exists: (tokenId: bigint) =>
      client
        .readContract({
          address: nft as Address,
          abi: nftAbi,
          functionName: 'ownerOf',
          args: [tokenId],
        })
        .then(
          () => true,
          () => false,
        ),
    ethBalance: (address: string) => client.getBalance({ address: address as Address }),
    balanceOf: (owner: string) =>
      client.readContract({
        address: nft as Address,
        abi: nftAbi,
        functionName: 'balanceOf',
        args: [owner as Address],
      }),
  };
}

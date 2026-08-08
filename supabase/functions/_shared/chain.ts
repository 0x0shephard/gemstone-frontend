import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hash,
} from 'npm:viem@2';
import { privateKeyToAccount } from 'npm:viem@2/accounts';
import { sepolia } from 'npm:viem@2/chains';

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function requiredAddress(name: string): Address {
  return getAddress(requiredEnv(name));
}

export const gemRegistryAbi = parseAbi([
  'function sellerApproved(address seller) view returns (bool)',
  'function setSellerApproval(address seller, bool approved)',
  'function registerGem(address seller, address custodian, string metadataURI, bytes32 certificateHash) returns (uint256 gemId)',
  'function getGem(uint256 gemId) view returns ((address seller,address custodian,string metadataURI,bytes32 certificateHash,uint256 priceUsd,uint256 tokenId,bytes32 redemptionRequestHash,uint8 status))',
  'function confirmCustody(uint256 gemId)',
  'function verifyGem(uint256 gemId, bytes32 valuationHash, bytes32 valuationMatrixHash, uint256 approvedValuationUsd)',
  'function listGem(uint256 gemId, uint256 priceUsd, uint8 saleMode)',
  'function primarySaleMode(uint256 gemId) view returns (uint8)',
  'event GemRegistered(uint256 indexed gemId, address indexed seller, address indexed custodian)',
]);

export const primarySaleAbi = parseAbi([
  'function createDailyAuction(uint256 gemId, uint256 floorUsd)',
  // Clears an expired auction so a fresh one can be opened. `_createAuction`
  // rejects a gem whose previous auction still `exists` and is unsettled, and an
  // auction that drew no bid is never settled — so re-opening requires this
  // first. It reverts `AuctionActive` while a real bid is live, which is what
  // stops the sweep from cancelling an auction someone is winning.
  'function cancelAuction(uint256 gemId)',
  // Permissionless and self-terminating: it either mints to the winner, or
  // refunds them and marks the auction settled. Either outcome unblocks
  // `_createAuction`, so the sweep can drive it without needing a role.
  'function settleAuction(uint256 gemId) returns (uint256 tokenId)',
  'function auctions(uint256 gemId) view returns (bool exists,bool settled,uint64 startTime,uint64 endTime,uint256 floorUsd,address highestBidder,address paymentAsset,uint256 amount,uint256 usdValue,uint256 reserveUsd)',
  'event BidPlaced(uint256 indexed gemId, address indexed bidder, address paymentAsset, uint256 amount, uint256 usdValue)',
]);

export const dgeNftAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getApproved(uint256 tokenId) view returns (address)',
  // Set while a redemption is in flight. `_update` reverts on a locked token,
  // so a gift card over one would fail at claim time rather than at issue time.
  'function transferLocked(uint256 tokenId) view returns (bool)',
  'function tokenGem(uint256 tokenId) view returns (uint256)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
]);

/**
 * The DGE NFT address.
 *
 * Resolved on demand rather than in {@link operatorChain}, so functions that
 * predate the gift-card flow do not start failing on a secret they never
 * needed.
 */
export function dgeNftAddress(): Address {
  return requiredAddress('DGE_NFT_ADDRESS');
}

export interface OperatorChain {
  account: ReturnType<typeof privateKeyToAccount>;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  addresses: {
    registry: Address;
    primarySale: Address;
  };
  deploymentBlock: bigint;
}

export function operatorChain(): OperatorChain {
  const rpcUrl = requiredEnv('SEPOLIA_RPC_URL');
  const privateKey = requiredEnv('SEPOLIA_OPERATOR_PRIVATE_KEY') as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl, { retryCount: 3, timeout: 30_000 });
  return {
    account,
    publicClient: createPublicClient({ chain: sepolia, transport }),
    walletClient: createWalletClient({ account, chain: sepolia, transport }),
    addresses: {
      registry: requiredAddress('GEM_REGISTRY_ADDRESS'),
      primarySale: requiredAddress('PRIMARY_SALE_AUCTION_ADDRESS'),
    },
    deploymentBlock: BigInt(requiredEnv('DEPLOYMENT_BLOCK')),
  };
}

export async function assertOperatorChain(chain: OperatorChain): Promise<void> {
  const [chainId, blockNumber, registryCode, primarySaleCode] = await Promise.all([
    chain.publicClient.getChainId(),
    chain.publicClient.getBlockNumber(),
    chain.publicClient.getCode({ address: chain.addresses.registry }),
    chain.publicClient.getCode({ address: chain.addresses.primarySale }),
  ]);
  if (chainId !== sepolia.id) {
    throw new Error(`Seller automation requires Sepolia; RPC returned chain ${chainId}`);
  }
  if (chain.deploymentBlock > blockNumber) {
    throw new Error('Deployment block is ahead of the current Sepolia block');
  }
  if (!registryCode || registryCode === '0x' || !primarySaleCode || primarySaleCode === '0x') {
    throw new Error('Seller automation contract configuration is invalid');
  }
}

export async function writeAndConfirm(
  chain: OperatorChain,
  parameters: Parameters<OperatorChain['publicClient']['simulateContract']>[0],
): Promise<Hash> {
  const simulation = await chain.publicClient.simulateContract({
    ...parameters,
    account: chain.account,
  } as Parameters<OperatorChain['publicClient']['simulateContract']>[0]);
  const hash = await chain.walletClient.writeContract(
    simulation.request as Parameters<OperatorChain['walletClient']['writeContract']>[0],
  );
  const receipt = await chain.publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 90_000,
  });
  if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted`);
  return hash;
}

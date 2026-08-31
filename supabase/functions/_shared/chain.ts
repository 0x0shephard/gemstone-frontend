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
import { resolveLogsRpcUrl } from './rpcSelection.ts';

/**
 * PublicNode accepts wide `eth_getLogs` ranges on Sepolia (the notification
 * bootstrap window is 50,000 blocks). It is used only for read-only history
 * scans when an operator has not supplied a dedicated `LOGS_RPC_URL`; signed
 * transactions continue to use `SEPOLIA_RPC_URL`.
 *
 * Falling back to the operator RPC is not a safe default here. Its plan may cap
 * log queries at ten blocks, and a scanner at that width falls farther behind
 * the chain even when every request succeeds.
 */
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
  // Read by the notification sweep. A win and a refunded settlement are both
  // things the bidder has to be told: one means they own a stone, the other
  // means their money is sitting in the contract waiting to be claimed.
  'event AuctionSettled(uint256 indexed gemId, uint256 indexed tokenId, address indexed winner, address paymentAsset, uint256 amount)',
  'event AuctionSettlementRefunded(uint256 indexed gemId, address indexed bidder, address indexed paymentAsset, uint256 amount, bytes32 reasonHash)',
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

/**
 * Secondary-market events the notification sweep reads.
 *
 * Events and the few views needed to tell a live offer from a settled one.
 * Nothing here is written to: the sweep observes, it does not act.
 */
export const marketplaceAbi = parseAbi([
  'event OfferCreated(uint256 indexed offerId, address indexed bidder, uint256 indexed tokenId, address paymentAsset, uint256 amount, uint256 saleUsdValue, uint64 expiry)',
  'event OfferCancelled(uint256 indexed offerId)',
  'event OfferAccepted(uint256 indexed offerId, address indexed seller)',
  // `Purchased` is deliberately absent. A sale pays the seller automatically, so
  // nothing is stranded, and the event carries only the buyer — telling the
  // seller would mean recovering their address from an earlier `Listed` event
  // that may sit outside the scan window. Worth doing, but not by guessing.
  'function offers(uint256 offerId) view returns (address bidder, uint256 tokenId, address paymentAsset, uint256 amount, uint256 saleUsdValue, uint64 expiry, bool active)',
  // Two fields, not three: `Listing` carries no `active` flag. An escrowed
  // token's listing is cleared on cancel, so a zero seller is what "not listed"
  // looks like.
  'function listings(uint256 tokenId) view returns (address seller, uint256 priceUsd)',
]);

export const swapEscrowAbi = parseAbi([
  'event OfferCreated(uint256 indexed offerId, address indexed proposer, uint256 indexed offeredTokenId, uint256 requestedTokenId, address cashAsset, uint256 cashAmount, bool proposerPaysCash, uint64 expiry)',
  'event OfferCancelled(uint256 indexed offerId)',
  'event OfferAccepted(uint256 indexed offerId, address indexed accepter)',
  'function offers(uint256 offerId) view returns (address proposer, uint256 offeredTokenId, uint256 requestedTokenId, address cashAsset, uint256 cashAmount, bool proposerPaysCash, uint64 expiry, bool active)',
]);

/**
 * Redemption lifecycle, for the notification sweep.
 *
 * Nothing advances a redemption automatically: `confirmRedemption` is callable
 * only by the address recorded as custodian on the gem. So the custodian being
 * told a request is open is not a courtesy — it is the only thing that starts
 * the second half of the flow.
 */
export const redemptionManagerAbi = parseAbi([
  'event RedemptionOpened(uint256 indexed tokenId, uint256 indexed gemId, address indexed owner, bytes32 requestHash)',
  'event RedemptionConfirmed(uint256 indexed tokenId, uint256 indexed gemId)',
  'event RedemptionCancelled(uint256 indexed tokenId, uint256 indexed gemId)',
]);

/** Addresses used only by the notification sweep, resolved on demand. */
export function marketplaceAddress(): Address {
  return requiredAddress('MARKETPLACE_ADDRESS');
}

export function redemptionManagerAddress(): Address {
  return requiredAddress('REDEMPTION_MANAGER_ADDRESS');
}

export function swapEscrowAddress(): Address {
  return requiredAddress('SWAP_ESCROW_ADDRESS');
}

export interface OperatorChain {
  account: ReturnType<typeof privateKeyToAccount>;
  publicClient: ReturnType<typeof createPublicClient>;
  /**
   * Read-only client used for `eth_getLogs`, which is the one call whose cost
   * providers meter by block range rather than by request.
   *
   * Separate from {@link publicClient} because the limit that matters here is
   * unrelated to the one that matters for writes. The operator RPC allows a
   * 10-block range on its plan; a history scan at that width needs more requests
   * per day than the chain produces blocks, so it can never catch up however
   * carefully it retries. Point `LOGS_RPC_URL` at a provider with a wide range
   * and the same scan is a couple of hundred calls.
   */
  logsClient: ReturnType<typeof createPublicClient>;
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
  // A dedicated operator value wins. The public fallback is deliberately
  // separate from the write RPC because only log scans need wide ranges and no
  // private key or signed payload is ever sent to it.
  const logsRpcUrl = resolveLogsRpcUrl(rpcUrl, Deno.env.get('LOGS_RPC_URL'));
  /*
   * Fails fast, unlike the write transport.
   *
   * A scan is budgeted between chunks, so the budget can only act if no single
   * chunk can outlast it. At the write transport's 30s timeout and three
   * retries, one unlucky call blocks for two minutes — long enough that the
   * platform kills the worker before the budget is ever re-checked, which is
   * exactly how a 40s budget produced a 150s run.
   *
   * Giving up early is cheap here in a way it is not for a write: the cursor is
   * committed as the scan proceeds, so an abandoned chunk is retried on the next
   * run rather than lost.
   */
  const logsTransport = http(logsRpcUrl, { retryCount: 1, timeout: 8_000 });
  return {
    account,
    publicClient: createPublicClient({ chain: sepolia, transport }),
    logsClient: createPublicClient({ chain: sepolia, transport: logsTransport }),
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

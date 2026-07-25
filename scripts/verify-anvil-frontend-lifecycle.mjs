import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  maxUint256,
  parseEther,
  parseUnits,
  stringToBytes,
  zeroAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const root = path.resolve(import.meta.dirname, '..');
const contractsRoot = path.resolve(root, process.env.CONTRACTS_DIR ?? '../gemstone');
const deployment = JSON.parse(
  fs.readFileSync(path.join(contractsRoot, 'deployments/sepolia.json'), 'utf8'),
);
const inventory = JSON.parse(
  fs.readFileSync(path.join(root, 'deployments/sepolia-demo-inventory.json'), 'utf8'),
);
const rpcUrl = process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8546';
const transport = http(rpcUrl, { retryCount: 1, timeout: 60_000 });
const publicClient = createPublicClient({ chain: sepolia, transport });
const abi = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, `src/contracts/generated/${name}.json`), 'utf8'));

// Avoid the standard Anvil accounts: some of those addresses have deployed
// contracts on Sepolia, which makes ERC-721 safe-mint receiver checks diverge
// from the normal EOA wallet path.
const accountA = privateKeyToAccount(keccak256(stringToBytes('digital-carat-anvil-buyer-a')));
const accountB = privateKeyToAccount(keccak256(stringToBytes('digital-carat-anvil-buyer-b')));
const walletA = createWalletClient({ account: accountA, chain: sepolia, transport });
const walletB = createWalletClient({ account: accountB, chain: sepolia, transport });
const adminWallet = createWalletClient({
  account: deployment.admin,
  chain: sepolia,
  transport,
});
const { addresses, paymentAssets } = deployment;
const usdc = paymentAssets.mockUsdc;
const buyNowGemId = BigInt(inventory.inventory.find((item) => item.slug === 'ruby-horizon').gemId);
const auctionGemId = BigInt(
  inventory.inventory.find((item) => item.slug === 'emerald-aurora').gemId,
);

process.on('unhandledRejection', (error) => {
  console.error(
    `Lifecycle verification failed: ${
      error && typeof error === 'object' && 'shortMessage' in error
        ? error.shortMessage
        : error instanceof Error
          ? error.message
          : 'Unknown error'
    }`,
  );
  process.exit(1);
});
process.on('uncaughtException', (error) => {
  console.error(`Lifecycle verification failed: ${error.message}`);
  process.exit(1);
});

const abis = {
  registry: abi('GemRegistry'),
  payment: abi('PaymentTokenRegistry'),
  reserve: abi('ReserveManager'),
  sale: abi('PrimarySaleAuction'),
  marketplace: abi('Marketplace'),
  swap: abi('SwapEscrow'),
  redemption: abi('RedemptionManager'),
  compliance: abi('ComplianceRegistry'),
  nft: abi('DGENFT'),
};
const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
];
const faucetAbi = [
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
];
const feedAbi = [
  {
    type: 'function',
    name: 'refresh',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
];

async function transact(label, wallet, parameters) {
  const { request, result } = await publicClient.simulateContract({
    account: wallet.account,
    ...parameters,
  });
  const hash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${label} reverted`);
  console.log(`PASS ${label}`);
  return result;
}

async function read(address, contractAbi, functionName, args = []) {
  return publicClient.readContract({ address, abi: contractAbi, functionName, args });
}

async function quote(usdValue) {
  return read(addresses.PaymentTokenRegistry, abis.payment, 'quoteUsdToToken', [usdc, usdValue]);
}

async function approveUsdc(wallet, spender) {
  await transact('ERC-20 approval', wallet, {
    address: usdc,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
  });
}

async function approveNft(wallet, spender, tokenId) {
  await transact('ERC-721 approval', wallet, {
    address: addresses.DGENFT,
    abi: abis.nft,
    functionName: 'approve',
    args: [spender, tokenId],
  });
}

await publicClient.request({
  method: 'anvil_impersonateAccount',
  params: [deployment.admin],
});
await publicClient.request({
  method: 'anvil_setBalance',
  params: [deployment.admin, `0x${parseEther('100').toString(16)}`],
});
for (const account of [accountA, accountB]) {
  await publicClient.request({
    method: 'anvil_setBalance',
    params: [account.address, `0x${parseEther('100').toString(16)}`],
  });
  if ((await publicClient.getCode({ address: account.address })) !== undefined) {
    throw new Error(`Fork fixture account unexpectedly has deployed code: ${account.address}`);
  }
}
await transact('refresh test oracle', adminWallet, {
  address: paymentAssets.mockUsdcUsdFeed,
  abi: feedAbi,
  functionName: 'refresh',
});

for (const wallet of [walletA, walletB]) {
  await transact('claim 10,000 mUSDC', wallet, {
    address: paymentAssets.mockUsdcFaucet,
    abi: faucetAbi,
    functionName: 'claim',
  });
  await approveUsdc(wallet, addresses.PrimarySaleAuction);
  await approveUsdc(wallet, addresses.Marketplace);
  await approveUsdc(wallet, addresses.SwapEscrow);
  await approveUsdc(wallet, addresses.ReserveManager);
}

const primaryGem = await read(addresses.GemRegistry, abis.registry, 'getGem', [buyNowGemId]);
const primaryShortfall = await read(addresses.ReserveManager, abis.reserve, 'shortfallUsd', [
  buyNowGemId,
  primaryGem.priceUsd,
]);
const primaryAmount = await quote(primaryGem.priceUsd + primaryShortfall);
await transact('frontend buy-now with reserve top-up', walletA, {
  address: addresses.PrimarySaleAuction,
  abi: abis.sale,
  functionName: 'buyNow',
  args: [buyNowGemId, usdc, primaryAmount],
});
const mintedPrimary = await read(addresses.GemRegistry, abis.registry, 'getGem', [buyNowGemId]);
const primaryTokenId = mintedPrimary.tokenId;
if ((await read(addresses.DGENFT, abis.nft, 'ownerOf', [primaryTokenId])) !== accountA.address) {
  throw new Error('Buy-now owner mismatch');
}

await approveNft(walletA, addresses.Marketplace, primaryTokenId);
const secondaryPrice = primaryGem.priceUsd + parseUnits('25', 18);
await transact('frontend secondary listing', walletA, {
  address: addresses.Marketplace,
  abi: abis.marketplace,
  functionName: 'list',
  args: [primaryTokenId, secondaryPrice],
});
const listingShortfall = await read(addresses.ReserveManager, abis.reserve, 'shortfallUsd', [
  buyNowGemId,
  primaryGem.priceUsd,
]);
const listingAmount = await quote(secondaryPrice + listingShortfall);
await transact('frontend secondary purchase', walletB, {
  address: addresses.Marketplace,
  abi: abis.marketplace,
  functionName: 'buy',
  args: [primaryTokenId, usdc, listingAmount],
});

const auctionGem = await read(addresses.GemRegistry, abis.registry, 'getGem', [auctionGemId]);
const auction = await read(addresses.PrimarySaleAuction, abis.sale, 'auctions', [auctionGemId]);
const auctionShortfall = await read(addresses.ReserveManager, abis.reserve, 'shortfallUsd', [
  auctionGemId,
  auctionGem.priceUsd,
]);
const auctionAmount = await quote(auction[4] + auctionShortfall);
await transact('frontend auction bid with reserve top-up', walletA, {
  address: addresses.PrimarySaleAuction,
  abi: abis.sale,
  functionName: 'bid',
  args: [auctionGemId, usdc, auctionAmount],
});
await publicClient.request({
  method: 'anvil_setNextBlockTimestamp',
  params: [Number(auction[3] + 1n)],
});
await publicClient.request({ method: 'evm_mine', params: [] });
await transact('frontend auction settlement', walletB, {
  address: addresses.PrimarySaleAuction,
  abi: abis.sale,
  functionName: 'settleAuction',
  args: [auctionGemId],
});
const settledAuctionGem = await read(addresses.GemRegistry, abis.registry, 'getGem', [
  auctionGemId,
]);
const auctionTokenId = settledAuctionGem.tokenId;

await transact('refresh oracle after time travel', adminWallet, {
  address: paymentAssets.mockUsdcUsdFeed,
  abi: feedAbi,
  functionName: 'refresh',
});
await approveNft(walletB, addresses.SwapEscrow, primaryTokenId);
const firstSwapId = await transact('frontend DGE-for-DGE swap proposal', walletB, {
  address: addresses.SwapEscrow,
  abi: abis.swap,
  functionName: 'createOffer',
  args: [
    primaryTokenId,
    auctionTokenId,
    zeroAddress,
    0n,
    false,
    BigInt(Number(auction[3] + 86_401n)),
  ],
});
await approveNft(walletA, addresses.SwapEscrow, auctionTokenId);
await transact('frontend DGE-for-DGE swap acceptance', walletA, {
  address: addresses.SwapEscrow,
  abi: abis.swap,
  functionName: 'acceptOffer',
  args: [firstSwapId],
});

await approveNft(walletA, addresses.SwapEscrow, primaryTokenId);
const cashDelta = await quote(parseUnits('100', 18));
const secondSwapId = await transact('frontend proposer-pays cash swap proposal', walletA, {
  address: addresses.SwapEscrow,
  abi: abis.swap,
  functionName: 'createOffer',
  args: [
    primaryTokenId,
    auctionTokenId,
    usdc,
    cashDelta,
    true,
    BigInt(Number(auction[3] + 86_401n)),
  ],
});
await approveNft(walletB, addresses.SwapEscrow, auctionTokenId);
await transact('frontend cash swap acceptance', walletB, {
  address: addresses.SwapEscrow,
  abi: abis.swap,
  functionName: 'acceptOffer',
  args: [secondSwapId],
});

const offerAmount = await quote(parseUnits('500', 18));
const acceptedOfferId = await transact('frontend marketplace offer creation', walletA, {
  address: addresses.Marketplace,
  abi: abis.marketplace,
  functionName: 'createOffer',
  args: [primaryTokenId, usdc, offerAmount],
});
await approveNft(walletB, addresses.Marketplace, primaryTokenId);
await transact('frontend marketplace offer acceptance', walletB, {
  address: addresses.Marketplace,
  abi: abis.marketplace,
  functionName: 'acceptOffer',
  args: [acceptedOfferId],
});

const refundableOfferId = await transact('frontend refundable offer creation', walletB, {
  address: addresses.Marketplace,
  abi: abis.marketplace,
  functionName: 'createOffer',
  args: [primaryTokenId, usdc, offerAmount],
});
const refundableOffer = await read(addresses.Marketplace, abis.marketplace, 'offers', [
  refundableOfferId,
]);
await publicClient.request({
  method: 'anvil_setNextBlockTimestamp',
  params: [Number(refundableOffer[5] + 1n)],
});
await publicClient.request({ method: 'evm_mine', params: [] });
await transact('frontend expired-offer refund', walletB, {
  address: addresses.Marketplace,
  abi: abis.marketplace,
  functionName: 'cancelExpiredOffer',
  args: [refundableOfferId],
});

await transact('refresh oracle after offer expiry', adminWallet, {
  address: paymentAssets.mockUsdcUsdFeed,
  abi: feedAbi,
  functionName: 'refresh',
});
await transact('approve redemption owner', adminWallet, {
  address: addresses.ComplianceRegistry,
  abi: abis.compliance,
  functionName: 'setRedemptionApproved',
  args: [accountA.address, true],
});
const requestHash = `0x${'42'.repeat(32)}`;
await transact('frontend redemption request', walletA, {
  address: addresses.RedemptionManager,
  abi: abis.redemption,
  functionName: 'requestRedemption',
  args: [auctionTokenId, requestHash],
});
await transact('frontend redemption cancellation', walletA, {
  address: addresses.RedemptionManager,
  abi: abis.redemption,
  functionName: 'cancelRedemption',
  args: [auctionTokenId],
});

console.log(
  JSON.stringify(
    {
      ok: true,
      buyNowTokenId: primaryTokenId.toString(),
      auctionTokenId: auctionTokenId.toString(),
      secondarySale: true,
      auctionBidAndSettlement: true,
      swapWithoutCash: true,
      swapWithCash: true,
      offerAcceptance: true,
      offerRefund: true,
      redemptionRequestAndCancellation: true,
    },
    null,
    2,
  ),
);

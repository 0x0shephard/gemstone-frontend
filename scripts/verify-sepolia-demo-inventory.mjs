import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createPublicClient, http, zeroAddress } from 'viem';
import { sepolia } from 'viem/chains';

const projectRoot = path.resolve(import.meta.dirname, '..');
const contractsRoot = path.resolve(projectRoot, process.env.CONTRACTS_DIR ?? '../gemstone');
const deployment = JSON.parse(
  fs.readFileSync(path.join(contractsRoot, 'deployments/sepolia.json'), 'utf8'),
);
const inventory = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'deployments/sepolia-demo-inventory.json'), 'utf8'),
);

const abi = (name) =>
  JSON.parse(
    fs.readFileSync(path.join(projectRoot, `src/contracts/generated/${name}.json`), 'utf8'),
  );
const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.VERIFY_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'),
});
const { addresses, paymentAssets } = deployment;
const bySlug = new Map(inventory.inventory.map((item) => [item.slug, item]));

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function read(address, contractAbi, functionName, args = []) {
  return client.readContract({ address, abi: contractAbi, functionName, args });
}

const registryAbi = abi('GemRegistry');
const saleAbi = abi('PrimarySaleAuction');
const nftAbi = abi('DGENFT');
const marketplaceAbi = abi('Marketplace');
const complianceAbi = abi('ComplianceRegistry');
const reserveAbi = abi('ReserveManager');
const currentBlock = await client.getBlock();

for (const slug of ['ruby-horizon', 'sapphire-meridian']) {
  const item = bySlug.get(slug);
  const gem = await read(addresses.GemRegistry, registryAbi, 'getGem', [BigInt(item.gemId)]);
  const mode = await read(addresses.GemRegistry, registryAbi, 'primarySaleMode', [
    BigInt(item.gemId),
  ]);
  expect(Number(gem.status) === 4, `${item.name} is not actively listed`);
  expect(Number(mode) === 1, `${item.name} is not configured for buy-now`);
}

const auctionItem = bySlug.get('emerald-aurora');
const auction = await read(addresses.PrimarySaleAuction, saleAbi, 'auctions', [
  BigInt(auctionItem.gemId),
]);
expect(auction[0] && !auction[1], 'Emerald Aurora auction is not active');
expect(Number(auction[3]) > Number(currentBlock.timestamp), 'Emerald Aurora auction has expired');

for (const [slug, expectedOwner] of [
  ['padparadscha-solstice', inventory.demoWallets.swapOwnerA],
  ['alexandrite-equinox', inventory.demoWallets.swapOwnerBAndRedemptionApproved],
]) {
  const item = bySlug.get(slug);
  const owner = await read(addresses.DGENFT, nftAbi, 'ownerOf', [BigInt(item.tokenId)]);
  expect(owner.toLowerCase() === expectedOwner.toLowerCase(), `${item.name} owner is incorrect`);
}

const secondaryItem = bySlug.get('spinel-atelier');
const secondaryTokenId = BigInt(secondaryItem.tokenId);
const [secondaryOwner, listing] = await Promise.all([
  read(addresses.DGENFT, nftAbi, 'ownerOf', [secondaryTokenId]),
  read(addresses.Marketplace, marketplaceAbi, 'listings', [secondaryTokenId]),
]);
expect(
  secondaryOwner.toLowerCase() === addresses.Marketplace.toLowerCase(),
  'Spinel Atelier is not escrowed by the marketplace',
);
expect(listing[0] !== zeroAddress, 'Spinel Atelier secondary listing is not active');

const offerItem = bySlug.get('padparadscha-solstice');
const offer = await read(addresses.Marketplace, marketplaceAbi, 'offers', [
  BigInt(inventory.activeMarketplaceOfferId),
]);
expect(offer[6], 'Demo marketplace offer is not active');
expect(BigInt(offer[1]) === BigInt(offerItem.tokenId), 'Demo offer targets the wrong token');
expect(
  offer[2].toLowerCase() === paymentAssets.mockUsdc.toLowerCase(),
  'Demo offer does not use mUSDC',
);
expect(Number(offer[5]) > Number(currentBlock.timestamp), 'Demo marketplace offer has expired');

const redemptionOwner = inventory.demoWallets.swapOwnerBAndRedemptionApproved;
const [approvalRequired, canRedeem, reserveBalance, reserveShortfall] = await Promise.all([
  read(addresses.ComplianceRegistry, complianceAbi, 'redemptionApprovalRequired'),
  read(addresses.ComplianceRegistry, complianceAbi, 'canRedeem', [redemptionOwner]),
  read(addresses.ReserveManager, reserveAbi, 'reserveBalanceUsd', [
    BigInt(bySlug.get('alexandrite-equinox').gemId),
  ]),
  read(addresses.ReserveManager, reserveAbi, 'shortfallUsd', [
    BigInt(bySlug.get('alexandrite-equinox').gemId),
    BigInt(bySlug.get('alexandrite-equinox').priceUsd),
  ]),
]);
expect(approvalRequired, 'Explicit redemption approval is not enabled');
expect(canRedeem, 'The redemption demo owner is not compliance-approved');
expect(
  reserveBalance > 0n && reserveShortfall === 0n,
  'The redemption token reserve is underfunded',
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checkedAtBlock: currentBlock.number.toString(),
      activeBuyNowGemIds: ['2', '3'],
      liveAuctionGemId: auctionItem.gemId,
      liveAuctionEndsAt: new Date(Number(auction[3]) * 1000).toISOString(),
      swapTokenIds: [
        bySlug.get('padparadscha-solstice').tokenId,
        bySlug.get('alexandrite-equinox').tokenId,
      ],
      secondaryListingTokenId: secondaryItem.tokenId,
      activeOfferId: inventory.activeMarketplaceOfferId,
      offerRefundAvailableAt: new Date(Number(offer[5]) * 1000).toISOString(),
      redemptionEligibleTokenId: bySlug.get('alexandrite-equinox').tokenId,
    },
    null,
    2,
  ),
);

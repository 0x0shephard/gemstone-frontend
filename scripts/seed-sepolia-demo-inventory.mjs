import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  maxUint256,
  parseUnits,
  stringToHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

function reportFatalError(error) {
  const detail =
    error && typeof error === 'object' && 'shortMessage' in error
      ? error.shortMessage
      : error instanceof Error
        ? error.message
        : 'Unknown error';

  console.error(`Demo inventory seed failed: ${detail}`);
  process.exit(1);
}

process.on('uncaughtException', reportFatalError);
process.on('unhandledRejection', reportFatalError);

const projectRoot = path.resolve(import.meta.dirname, '..');
const contractsRoot = path.resolve(projectRoot, process.env.CONTRACTS_DIR ?? '../gemstone');
const deploymentPath = path.join(contractsRoot, 'deployments/sepolia.json');
const contractsEnvPath = path.join(contractsRoot, '.env');
const outputPath = path.join(projectRoot, 'deployments/sepolia-demo-inventory.json');

function parseEnv(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [
          line.slice(0, index).trim(),
          line
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ''),
        ];
      }),
  );
}

function abi(name) {
  return JSON.parse(
    fs.readFileSync(path.join(projectRoot, `src/contracts/generated/${name}.json`), 'utf8'),
  );
}

function metadataUri(spec) {
  const metadata = {
    name: spec.name,
    displayId: spec.displayId,
    description: spec.description,
    gemstoneType: spec.gemstoneType,
    caratWeight: spec.caratWeight,
    origin: spec.origin,
    color: spec.color,
    clarity: spec.clarity,
    cut: spec.cut,
    treatment: spec.treatment,
    gradingLab: 'Digital Carat Sepolia Lab',
    certificateNumber: `SEP-${spec.slug.toUpperCase()}-V1`,
    custodian: {
      provider: 'Digital Carat Test Custody',
      country: 'Pakistan',
    },
    redeemable: spec.redeemable,
    testnet: true,
    network: 'ethereum-sepolia',
  };
  return `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`;
}

const usd = (value) => parseUnits(String(value), 18);
const commitment = (label) => keccak256(stringToHex(`digital-carat:${label}:v1`));

const inventory = [
  {
    group: 'primary-buy-now',
    slug: 'ruby-horizon',
    name: 'Ruby Horizon',
    displayId: 'DGE-SEPOLIA-RUBY-002',
    description: 'Expert-approved ruby demo inventory for immediate Sepolia purchase.',
    gemstoneType: 'Ruby',
    caratWeight: 1.42,
    origin: 'Mozambique',
    color: 'Vivid red',
    clarity: 'Eye clean',
    cut: 'Oval',
    treatment: 'Heat',
    priceUsd: usd(450),
    saleMode: 1,
    action: 'leave-listed',
    redeemable: true,
  },
  {
    group: 'primary-buy-now',
    slug: 'sapphire-meridian',
    name: 'Sapphire Meridian',
    displayId: 'DGE-SEPOLIA-SAPPHIRE-003',
    description: 'Expert-approved sapphire demo inventory for immediate Sepolia purchase.',
    gemstoneType: 'Sapphire',
    caratWeight: 2.08,
    origin: 'Sri Lanka',
    color: 'Royal blue',
    clarity: 'VS',
    cut: 'Cushion',
    treatment: 'Heat',
    priceUsd: usd(620),
    saleMode: 1,
    action: 'leave-listed',
    redeemable: true,
  },
  {
    group: 'live-auction',
    slug: 'emerald-aurora',
    name: 'Emerald Aurora',
    displayId: 'DGE-SEPOLIA-EMERALD-004',
    description: 'Expert-approved emerald used for the live 24-hour auction demonstration.',
    gemstoneType: 'Emerald',
    caratWeight: 1.76,
    origin: 'Zambia',
    color: 'Deep green',
    clarity: 'Minor inclusions',
    cut: 'Emerald',
    treatment: 'Minor oil',
    priceUsd: usd(800),
    saleMode: 2,
    action: 'auction',
    redeemable: true,
  },
  {
    group: 'swap-pair-and-offer',
    slug: 'padparadscha-solstice',
    name: 'Padparadscha Solstice',
    displayId: 'DGE-SEPOLIA-PADPARADSCHA-005',
    description: 'Minted Sepolia swap and marketplace-offer demonstration token.',
    gemstoneType: 'Padparadscha Sapphire',
    caratWeight: 1.31,
    origin: 'Sri Lanka',
    color: 'Pink-orange',
    clarity: 'VS',
    cut: 'Oval',
    treatment: 'Heat',
    priceUsd: usd(1_100),
    saleMode: 1,
    action: 'mint-transfer-a',
    redeemable: true,
  },
  {
    group: 'swap-pair-and-redemption',
    slug: 'alexandrite-equinox',
    name: 'Alexandrite Equinox',
    displayId: 'DGE-SEPOLIA-ALEXANDRITE-006',
    description: 'Minted Sepolia swap token with explicit redemption compliance approval.',
    gemstoneType: 'Alexandrite',
    caratWeight: 0.94,
    origin: 'Brazil',
    color: 'Green to purplish red',
    clarity: 'SI',
    cut: 'Round',
    treatment: 'None',
    priceUsd: usd(1_350),
    saleMode: 1,
    action: 'mint-transfer-b',
    redeemable: true,
  },
  {
    group: 'secondary-listing',
    slug: 'spinel-atelier',
    name: 'Spinel Atelier',
    displayId: 'DGE-SEPOLIA-SPINEL-007',
    description:
      'Minted and escrowed Sepolia token for the active secondary listing demonstration.',
    gemstoneType: 'Spinel',
    caratWeight: 1.63,
    origin: 'Tanzania',
    color: 'Hot pink',
    clarity: 'Eye clean',
    cut: 'Pear',
    treatment: 'None',
    priceUsd: usd(520),
    secondaryPriceUsd: usd(590),
    saleMode: 1,
    action: 'mint-list-secondary',
    redeemable: true,
  },
];

if (process.env.CONFIRM_DEMO_SEED !== 'YES') {
  throw new Error('Set CONFIRM_DEMO_SEED=YES to authorize Sepolia demo inventory writes');
}

const localEnv = parseEnv(fs.readFileSync(contractsEnvPath, 'utf8'));
const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
const rpcUrl = process.env.SEPOLIA_RPC_URL ?? localEnv.SEPOLIA_RPC_URL;
const privateKeyRaw = process.env.PRIVATE_KEY ?? localEnv.PRIVATE_KEY;
if (!rpcUrl || !privateKeyRaw)
  throw new Error('Sepolia RPC URL and operator private key are required');
if (deployment.chainId !== sepolia.id) throw new Error('Deployment manifest is not Sepolia');

const privateKey = privateKeyRaw.startsWith('0x') ? privateKeyRaw : `0x${privateKeyRaw}`;
const account = privateKeyToAccount(privateKey);
if (account.address.toLowerCase() !== deployment.admin.toLowerCase()) {
  throw new Error('Configured signer does not match the Sepolia deployment admin');
}

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
const addresses = deployment.addresses;
const mockUsdc = deployment.paymentAssets.mockUsdc;
const mockUsdFeed = deployment.paymentAssets.mockUsdcUsdFeed;

const registryAbi = abi('GemRegistry');
const nftAbi = abi('DGENFT');
const saleAbi = abi('PrimarySaleAuction');
const reserveAbi = abi('ReserveManager');
const paymentAbi = abi('PaymentTokenRegistry');
const marketplaceAbi = abi('Marketplace');
const complianceAbi = abi('ComplianceRegistry');
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
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
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

async function transact(label, parameters) {
  const { request, result } = await publicClient.simulateContract({
    account,
    ...parameters,
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
  });
  if (receipt.status !== 'success') throw new Error(`${label} reverted`);
  console.log(`${label}: ${hash}`);
  return { result, receipt };
}

async function readGem(gemId) {
  return publicClient.readContract({
    address: addresses.GemRegistry,
    abi: registryAbi,
    functionName: 'getGem',
    args: [gemId],
  });
}

async function discoverGems() {
  const result = [];
  for (let gemId = 1n; gemId <= 10_000n; gemId += 1n) {
    try {
      result.push({ gemId, gem: await readGem(gemId) });
    } catch {
      break;
    }
  }
  return result;
}

async function ensureApproval(spender) {
  const allowance = await publicClient.readContract({
    address: mockUsdc,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, spender],
  });
  if (allowance > parseUnits('1000000', 6)) return;
  await transact(`Approve mUSDC for ${spender}`, {
    address: mockUsdc,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
  });
}

async function ensureListed(spec, existingByCertificate) {
  const certificateHash = commitment(`${spec.slug}:certificate`);
  const valuationHash = commitment(`${spec.slug}:valuation`);
  const valuationMatrixHash = commitment('pricing-matrix:demo-2026-07');
  let existing = existingByCertificate.get(certificateHash);
  let gemId = existing?.gemId;
  let gem = existing?.gem;

  if (!gem) {
    const registration = await transact(`Register ${spec.name}`, {
      address: addresses.GemRegistry,
      abi: registryAbi,
      functionName: 'registerGem',
      args: [account.address, account.address, metadataUri(spec), certificateHash],
    });
    gemId = registration.result;
    gem = await readGem(gemId);
  }
  if (Number(gem.status) === 1) {
    await transact(`Confirm custody ${spec.name}`, {
      address: addresses.GemRegistry,
      abi: registryAbi,
      functionName: 'confirmCustody',
      args: [gemId],
    });
    gem = await readGem(gemId);
  }
  if (Number(gem.status) === 2) {
    await transact(`Verify ${spec.name}`, {
      address: addresses.GemRegistry,
      abi: registryAbi,
      functionName: 'verifyGem',
      args: [gemId, valuationHash, valuationMatrixHash, spec.priceUsd],
    });
    gem = await readGem(gemId);
  }
  if (Number(gem.status) === 3) {
    await transact(`List ${spec.name}`, {
      address: addresses.GemRegistry,
      abi: registryAbi,
      functionName: 'listGem',
      args: [gemId, spec.priceUsd, spec.saleMode],
    });
    gem = await readGem(gemId);
  }
  return { gemId, gem, certificateHash };
}

async function buyGem(spec, gemId) {
  const gem = await readGem(gemId);
  if (Number(gem.status) === 5) return gem.tokenId;
  if (Number(gem.status) !== 4) throw new Error(`${spec.name} is not ready for purchase`);

  const reserveShortfallUsd = await publicClient.readContract({
    address: addresses.ReserveManager,
    abi: reserveAbi,
    functionName: 'shortfallUsd',
    args: [gemId, spec.priceUsd],
  });
  const amount = await publicClient.readContract({
    address: addresses.PaymentTokenRegistry,
    abi: paymentAbi,
    functionName: 'quoteUsdToToken',
    args: [mockUsdc, spec.priceUsd + reserveShortfallUsd],
  });
  const purchase = await transact(`Buy ${spec.name}`, {
    address: addresses.PrimarySaleAuction,
    abi: saleAbi,
    functionName: 'buyNow',
    args: [gemId, mockUsdc, amount],
  });
  return purchase.result;
}

async function ownerOf(tokenId) {
  return publicClient.readContract({
    address: addresses.DGENFT,
    abi: nftAbi,
    functionName: 'ownerOf',
    args: [tokenId],
  });
}

async function transferTo(tokenId, recipient, label) {
  const owner = await ownerOf(tokenId);
  if (owner.toLowerCase() === recipient.toLowerCase()) return;
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`${label} is owned by an unexpected account`);
  }
  await transact(`Transfer ${label}`, {
    address: addresses.DGENFT,
    abi: nftAbi,
    functionName: 'safeTransferFrom',
    args: [account.address, recipient, tokenId],
  });
}

const demoWalletA = `0x${commitment('wallet:a').slice(-40)}`;
const demoWalletB = `0x${commitment('wallet:b').slice(-40)}`;
const latestBlock = await publicClient.getBlock();
console.log(`Sepolia block ${latestBlock.number}; operator ${account.address}`);
console.log(`Demo wallet A ${demoWalletA}`);
console.log(`Demo wallet B ${demoWalletB}`);

await transact('Refresh mUSDC/USD feed', {
  address: mockUsdFeed,
  abi: feedAbi,
  functionName: 'refresh',
});

const minimumMusdc = parseUnits('10000', 6);
const currentMusdc = await publicClient.readContract({
  address: mockUsdc,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [account.address],
});
if (currentMusdc < minimumMusdc) {
  await transact('Mint operator mUSDC', {
    address: mockUsdc,
    abi: erc20Abi,
    functionName: 'mint',
    args: [account.address, minimumMusdc - currentMusdc],
  });
}
await ensureApproval(addresses.PrimarySaleAuction);
await ensureApproval(addresses.Marketplace);

const existingGems = await discoverGems();
const existingByCertificate = new Map(
  existingGems.map(({ gemId, gem }) => [gem.certificateHash, { gemId, gem }]),
);
const seeded = [];

for (const spec of inventory) {
  const record = await ensureListed(spec, existingByCertificate);
  let tokenId = record.gem.tokenId;

  if (spec.action === 'auction') {
    let auction = await publicClient.readContract({
      address: addresses.PrimarySaleAuction,
      abi: saleAbi,
      functionName: 'auctions',
      args: [record.gemId],
    });
    const currentBlock = await publicClient.getBlock();
    if (
      auction[0] &&
      !auction[1] &&
      auction[5] === '0x0000000000000000000000000000000000000000' &&
      auction[3] <= currentBlock.timestamp
    ) {
      await transact(`Cancel expired empty auction ${spec.name}`, {
        address: addresses.PrimarySaleAuction,
        abi: saleAbi,
        functionName: 'cancelAuction',
        args: [record.gemId],
      });
      auction = await publicClient.readContract({
        address: addresses.PrimarySaleAuction,
        abi: saleAbi,
        functionName: 'auctions',
        args: [record.gemId],
      });
    }
    if (!auction[0]) {
      await transact(`Create auction ${spec.name}`, {
        address: addresses.PrimarySaleAuction,
        abi: saleAbi,
        functionName: 'createDailyAuction',
        args: [record.gemId, spec.priceUsd],
      });
    }
  } else if (spec.action !== 'leave-listed') {
    tokenId = await buyGem(spec, record.gemId);
    if (spec.action === 'mint-transfer-a') {
      await transferTo(tokenId, demoWalletA, spec.name);
    }
    if (spec.action === 'mint-transfer-b') {
      await transferTo(tokenId, demoWalletB, spec.name);
    }
    if (spec.action === 'mint-list-secondary') {
      const listing = await publicClient.readContract({
        address: addresses.Marketplace,
        abi: marketplaceAbi,
        functionName: 'listings',
        args: [tokenId],
      });
      if (listing[0] === '0x0000000000000000000000000000000000000000') {
        await transact(`Approve secondary listing ${spec.name}`, {
          address: addresses.DGENFT,
          abi: nftAbi,
          functionName: 'approve',
          args: [addresses.Marketplace, tokenId],
        });
        await transact(`Create secondary listing ${spec.name}`, {
          address: addresses.Marketplace,
          abi: marketplaceAbi,
          functionName: 'list',
          args: [tokenId, spec.secondaryPriceUsd],
        });
      }
    }
  }

  seeded.push({
    group: spec.group,
    slug: spec.slug,
    name: spec.name,
    displayId: spec.displayId,
    gemId: record.gemId.toString(),
    tokenId: tokenId.toString(),
    action: spec.action,
    priceUsd: spec.priceUsd.toString(),
  });
}

const offerToken = BigInt(seeded.find((item) => item.action === 'mint-transfer-a')?.tokenId ?? '0');
let activeOfferId = 0n;
for (let offerId = 1n; offerId <= 100n; offerId += 1n) {
  const offer = await publicClient.readContract({
    address: addresses.Marketplace,
    abi: marketplaceAbi,
    functionName: 'offers',
    args: [offerId],
  });
  if (
    offer[6] &&
    offer[0].toLowerCase() === account.address.toLowerCase() &&
    offer[1] === offerToken
  ) {
    const currentBlock = await publicClient.getBlock();
    if (offer[5] <= currentBlock.timestamp) {
      await transact('Refund expired demo marketplace offer', {
        address: addresses.Marketplace,
        abi: marketplaceAbi,
        functionName: 'cancelExpiredOffer',
        args: [offerId],
      });
    } else {
      activeOfferId = offerId;
      break;
    }
  }
}
if (activeOfferId === 0n) {
  const offerUsd = usd(1_000);
  const offerAmount = await publicClient.readContract({
    address: addresses.PaymentTokenRegistry,
    abi: paymentAbi,
    functionName: 'quoteUsdToToken',
    args: [mockUsdc, offerUsd],
  });
  const offer = await transact('Create 24-hour mUSDC marketplace offer', {
    address: addresses.Marketplace,
    abi: marketplaceAbi,
    functionName: 'createOffer',
    args: [offerToken, mockUsdc, offerAmount],
  });
  activeOfferId = offer.result;
}

const approvalRequired = await publicClient.readContract({
  address: addresses.ComplianceRegistry,
  abi: complianceAbi,
  functionName: 'redemptionApprovalRequired',
});
if (!approvalRequired) {
  await transact('Require explicit redemption approval', {
    address: addresses.ComplianceRegistry,
    abi: complianceAbi,
    functionName: 'setRedemptionApprovalRequired',
    args: [true],
  });
}
for (const wallet of [account.address, demoWalletB]) {
  const approved = await publicClient.readContract({
    address: addresses.ComplianceRegistry,
    abi: complianceAbi,
    functionName: 'redemptionApproved',
    args: [wallet],
  });
  if (!approved) {
    await transact(`Approve redemption ${wallet}`, {
      address: addresses.ComplianceRegistry,
      abi: complianceAbi,
      functionName: 'setRedemptionApproved',
      args: [wallet, true],
    });
  }
}

const finalBlock = await publicClient.getBlockNumber();
const auctionGemId = BigInt(seeded.find((item) => item.action === 'auction')?.gemId ?? '0');
const [finalAuction, finalOffer] = await Promise.all([
  publicClient.readContract({
    address: addresses.PrimarySaleAuction,
    abi: saleAbi,
    functionName: 'auctions',
    args: [auctionGemId],
  }),
  publicClient.readContract({
    address: addresses.Marketplace,
    abi: marketplaceAbi,
    functionName: 'offers',
    args: [activeOfferId],
  }),
]);
const manifest = {
  schemaVersion: 1,
  network: 'ethereum-sepolia',
  chainId: sepolia.id,
  seededAt: new Date().toISOString(),
  finalBlock: finalBlock.toString(),
  operator: account.address,
  demoWallets: {
    swapOwnerA: demoWalletA,
    swapOwnerBAndRedemptionApproved: demoWalletB,
  },
  activeMarketplaceOfferId: activeOfferId.toString(),
  liveAuctionEndsAt: new Date(Number(finalAuction[3]) * 1000).toISOString(),
  offerRefundAvailableAt: new Date(Number(finalOffer[5]) * 1000).toISOString(),
  inventory: seeded,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Demo inventory manifest written to ${outputPath}`);

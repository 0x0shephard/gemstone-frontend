/**
 * PLACEHOLDER ABIs — do NOT rely on these for real calls yet.
 *
 * Each export is a minimal, illustrative fragment covering the functions/events
 * the frontend spec references for that module. When the contracts are compiled,
 * REPLACE each fragment with the generated ABI from `out/<Module>.sol/<Module>.json`
 * (e.g. `import DGENFT from '../../out/DGENFT.sol/DGENFT.json'`) and delete the
 * TODO banners. Shapes here are intentionally partial and unverified.
 *
 * These are exported as `const` tuples so viem can infer types once real ABIs
 * are dropped in.
 */

// TODO: replace with generated ABI — DGENFT (ERC-721 gemstone token)
export const dgeNftAbi = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'gemOfToken', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'tokenOfGem', stateMutability: 'view', inputs: [{ name: 'gemId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const;

// TODO: replace with generated ABI — GemRegistry (lifecycle & status)
export const gemRegistryAbi = [
  { type: 'function', name: 'getGem', stateMutability: 'view', inputs: [{ name: 'gemId', type: 'uint256' }], outputs: [{ type: 'tuple', components: [] }] },
  { type: 'function', name: 'canMint', stateMutability: 'view', inputs: [{ name: 'gemId', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

// TODO: replace with generated ABI — PaymentTokenRegistry
export const paymentTokenRegistryAbi = [
  { type: 'function', name: 'isAccepted', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'quoteUsd', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const;

// TODO: replace with generated ABI — ReserveManager
export const reserveManagerAbi = [
  { type: 'function', name: 'requiredReserveUsd', stateMutability: 'view', inputs: [{ name: 'gemId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'reserveBalanceUsd', stateMutability: 'view', inputs: [{ name: 'gemId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'shortfallUsd', stateMutability: 'view', inputs: [{ name: 'gemId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'reserveBpsFor', stateMutability: 'view', inputs: [{ name: 'gemId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'minimumReserveUsd', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

// TODO: replace with generated ABI — Treasury
export const treasuryAbi = [] as const;

// TODO: replace with generated ABI — PrimarySaleAuction
export const primarySaleAuctionAbi = [
  { type: 'function', name: 'buyNow', stateMutability: 'payable', inputs: [{ name: 'gemId', type: 'uint256' }, { name: 'paymentAsset', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'bid', stateMutability: 'payable', inputs: [{ name: 'gemId', type: 'uint256' }, { name: 'paymentAsset', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'settleAuction', stateMutability: 'nonpayable', inputs: [{ name: 'gemId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'settleExpiredAuctions', stateMutability: 'nonpayable', inputs: [{ name: 'gemIds', type: 'uint256[]' }], outputs: [] },
  { type: 'function', name: 'claimRefund', stateMutability: 'nonpayable', inputs: [{ name: 'asset', type: 'address' }], outputs: [] },
] as const;

// TODO: replace with generated ABI — Marketplace
export const marketplaceAbi = [
  { type: 'function', name: 'list', stateMutability: 'nonpayable', inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'priceUsd', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'buy', stateMutability: 'payable', inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'paymentAsset', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'cancelListing', stateMutability: 'nonpayable', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'createOffer', stateMutability: 'payable', inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'paymentAsset', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'acceptOffer', stateMutability: 'nonpayable', inputs: [{ name: 'offerId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'cancelExpiredOffer', stateMutability: 'nonpayable', inputs: [{ name: 'offerId', type: 'uint256' }], outputs: [] },
] as const;

// TODO: replace with generated ABI — SwapEscrow
export const swapEscrowAbi = [
  { type: 'function', name: 'createOffer', stateMutability: 'payable', inputs: [], outputs: [] },
  { type: 'function', name: 'acceptOffer', stateMutability: 'payable', inputs: [{ name: 'offerId', type: 'uint256' }], outputs: [] },
] as const;

// TODO: replace with generated ABI — RedemptionManager
export const redemptionManagerAbi = [
  { type: 'function', name: 'requestRedemption', stateMutability: 'nonpayable', inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'requestHash', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'cancelRedemption', stateMutability: 'nonpayable', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [] },
] as const;

// TODO: replace with generated ABI — ComplianceRegistry
export const complianceRegistryAbi = [
  { type: 'function', name: 'canRedeem', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

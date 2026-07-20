/**
 * On-chain module address map, read from env. NO production addresses are
 * hardcoded here — they must be provided via VITE_CONTRACT_* env vars.
 * `address` is `undefined` until configured; UI treats that as "not deployed".
 *
 * When real ABIs land, pair these addresses with `src/contracts/abis/*` in the
 * future wagmi-backed data service (see `src/services/index.ts`).
 */
import type { Address } from 'viem';

export type ContractModule =
  | 'DGENFT'
  | 'GemRegistry'
  | 'PaymentTokenRegistry'
  | 'ReserveManager'
  | 'Treasury'
  | 'PrimarySaleAuction'
  | 'Marketplace'
  | 'SwapEscrow'
  | 'RedemptionManager'
  | 'ComplianceRegistry';

const raw = import.meta.env;

function readAddress(key: string): Address | undefined {
  const v = raw[key];
  if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) return v as Address;
  return undefined;
}

export const contractAddresses: Record<ContractModule, Address | undefined> = {
  DGENFT: readAddress('VITE_CONTRACT_DGENFT'),
  GemRegistry: readAddress('VITE_CONTRACT_GEM_REGISTRY'),
  PaymentTokenRegistry: readAddress('VITE_CONTRACT_PAYMENT_TOKEN_REGISTRY'),
  ReserveManager: readAddress('VITE_CONTRACT_RESERVE_MANAGER'),
  Treasury: readAddress('VITE_CONTRACT_TREASURY'),
  PrimarySaleAuction: readAddress('VITE_CONTRACT_PRIMARY_SALE_AUCTION'),
  Marketplace: readAddress('VITE_CONTRACT_MARKETPLACE'),
  SwapEscrow: readAddress('VITE_CONTRACT_SWAP_ESCROW'),
  RedemptionManager: readAddress('VITE_CONTRACT_REDEMPTION_MANAGER'),
  ComplianceRegistry: readAddress('VITE_CONTRACT_COMPLIANCE_REGISTRY'),
};

export function getContractAddress(module: ContractModule): Address | undefined {
  return contractAddresses[module];
}

/** Native ETH sentinel used across the protocol for the payment asset. */
export const NATIVE_ASSET: Address = '0x0000000000000000000000000000000000000000';

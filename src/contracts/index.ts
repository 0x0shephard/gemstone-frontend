/**
 * Contract registry: pairs each module's (placeholder) ABI with its configured
 * address. Consumed by a future wagmi-backed data service. Nothing here performs
 * real reads yet — addresses may be `undefined` until env is set, and the ABIs
 * are placeholders (see `./abis`).
 */
import { contractAddresses, type ContractModule } from '@/config/contracts';
import {
  dgeNftAbi,
  gemRegistryAbi,
  paymentTokenRegistryAbi,
  reserveManagerAbi,
  treasuryAbi,
  primarySaleAuctionAbi,
  marketplaceAbi,
  swapEscrowAbi,
  redemptionManagerAbi,
  complianceRegistryAbi,
} from './abis';

export const contracts = {
  DGENFT: { address: contractAddresses.DGENFT, abi: dgeNftAbi },
  GemRegistry: { address: contractAddresses.GemRegistry, abi: gemRegistryAbi },
  PaymentTokenRegistry: { address: contractAddresses.PaymentTokenRegistry, abi: paymentTokenRegistryAbi },
  ReserveManager: { address: contractAddresses.ReserveManager, abi: reserveManagerAbi },
  Treasury: { address: contractAddresses.Treasury, abi: treasuryAbi },
  PrimarySaleAuction: { address: contractAddresses.PrimarySaleAuction, abi: primarySaleAuctionAbi },
  Marketplace: { address: contractAddresses.Marketplace, abi: marketplaceAbi },
  SwapEscrow: { address: contractAddresses.SwapEscrow, abi: swapEscrowAbi },
  RedemptionManager: { address: contractAddresses.RedemptionManager, abi: redemptionManagerAbi },
  ComplianceRegistry: { address: contractAddresses.ComplianceRegistry, abi: complianceRegistryAbi },
} as const;

/** True when every module has a configured address (real integration ready). */
export function allContractsConfigured(): boolean {
  return (Object.keys(contracts) as ContractModule[]).every((m) => !!contracts[m].address);
}

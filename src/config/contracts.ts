import { getAddress, isAddress, keccak256, toBytes, type Address } from 'viem';
import { env, environmentErrors } from './env';

export const contractModules = [
  'DGENFT',
  'GemRegistry',
  'PaymentTokenRegistry',
  'ReserveManager',
  'Treasury',
  'PrimarySaleAuction',
  'Marketplace',
  'SwapEscrow',
  'RedemptionManager',
  'ComplianceRegistry',
] as const;

export type ContractModule = (typeof contractModules)[number];
export const NATIVE_ASSET: Address = '0x0000000000000000000000000000000000000000';

const keys: Record<ContractModule, string> = {
  DGENFT: 'VITE_CONTRACT_DGENFT',
  GemRegistry: 'VITE_CONTRACT_GEM_REGISTRY',
  PaymentTokenRegistry: 'VITE_CONTRACT_PAYMENT_TOKEN_REGISTRY',
  ReserveManager: 'VITE_CONTRACT_RESERVE_MANAGER',
  Treasury: 'VITE_CONTRACT_TREASURY',
  PrimarySaleAuction: 'VITE_CONTRACT_PRIMARY_SALE_AUCTION',
  Marketplace: 'VITE_CONTRACT_MARKETPLACE',
  SwapEscrow: 'VITE_CONTRACT_SWAP_ESCROW',
  RedemptionManager: 'VITE_CONTRACT_REDEMPTION_MANAGER',
  ComplianceRegistry: 'VITE_CONTRACT_COMPLIANCE_REGISTRY',
};

function parseAddress(key: string): Address | undefined {
  const value = import.meta.env[key];
  return typeof value === 'string' && isAddress(value) ? getAddress(value) : undefined;
}

export const contractAddresses = Object.fromEntries(
  contractModules.map((moduleName) => [moduleName, parseAddress(keys[moduleName])]),
) as Record<ContractModule, Address | undefined>;

export const usdcAddress = parseAddress('VITE_USDC_ADDRESS');

export interface DeploymentManifest {
  schemaVersion: 1;
  chainId: number;
  deploymentBlock: bigint;
  addresses: Record<ContractModule, Address>;
  nativeAsset: Address;
  usdc: Address;
}

const missing = contractModules
  .filter((moduleName) => !contractAddresses[moduleName])
  .map((moduleName) => keys[moduleName]);

export const deploymentErrors = [
  ...environmentErrors,
  ...(env.deploymentBlock === undefined ? ['VITE_DEPLOYMENT_BLOCK is required'] : []),
  ...missing.map((key) => `${key} must be a valid address`),
  ...(usdcAddress ? [] : ['VITE_USDC_ADDRESS must be a valid address']),
];

export const deploymentManifest: DeploymentManifest | undefined =
  deploymentErrors.length === 0
    ? {
        schemaVersion: 1,
        chainId: env.chainId,
        deploymentBlock: env.deploymentBlock!,
        addresses: contractAddresses as Record<ContractModule, Address>,
        nativeAsset: NATIVE_ASSET,
        usdc: usdcAddress!,
      }
    : undefined;

export const deploymentManifestHash = deploymentManifest
  ? keccak256(
      toBytes(
        JSON.stringify(deploymentManifest, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        ),
      ),
    )
  : undefined;

export function requireDeploymentManifest(): DeploymentManifest {
  if (!deploymentManifest) {
    throw new Error(`Chain configuration is incomplete:\n${deploymentErrors.join('\n')}`);
  }
  return deploymentManifest;
}

export function getContractAddress(moduleName: ContractModule): Address | undefined {
  return contractAddresses[moduleName];
}

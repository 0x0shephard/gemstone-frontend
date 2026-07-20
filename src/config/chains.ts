import { sepolia, mainnet, hardhat } from 'wagmi/chains';
import type { Chain } from 'viem';
import { env } from './env';

const KNOWN: Record<number, Chain> = {
  [sepolia.id]: sepolia,
  [mainnet.id]: mainnet,
  [hardhat.id]: hardhat,
};

/** The chain the app targets, chosen by VITE_CHAIN_ID (default Sepolia). */
export const activeChain: Chain = KNOWN[env.chainId] ?? sepolia;

export const supportedChains: readonly [Chain, ...Chain[]] = [activeChain];

export function explorerTxUrl(hash: string): string {
  return `${env.explorerBaseUrl.replace(/\/$/, '')}/tx/${hash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${env.explorerBaseUrl.replace(/\/$/, '')}/address/${address}`;
}

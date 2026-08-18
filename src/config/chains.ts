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

/**
 * The chain the app targets, plus the ones a wallet is likely to arrive on.
 *
 * Only the target used to be configured, which left wagmi unable to represent a
 * wallet being anywhere else. `useChainId` then reported the configured default
 * rather than the truth, so a wallet sitting on mainnet looked correct: the
 * wrong-network warning never appeared, the SIWE button was offered, and the
 * signature failed with "Chain not configured" — wagmi being asked to move to a
 * chain it had never been told about.
 *
 * That is reachable only over WalletConnect, where the session brings whatever
 * chain the wallet already had. An injected provider is usually on the right one
 * because the person switched it themselves, which is why this hid.
 *
 * Listing mainnet does not make it a place the app works. Writes call
 * `ensureChain` first, reads are pinned to `activeChain`'s own transport, and
 * verification refuses while the network is wrong. It is here so the mismatch
 * can be seen and corrected instead of throwing.
 */
export const supportedChains: readonly [Chain, ...Chain[]] =
  activeChain.id === mainnet.id ? [mainnet] : [activeChain, mainnet];

export function explorerTxUrl(hash: string): string {
  return `${env.explorerBaseUrl.replace(/\/$/, '')}/tx/${hash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${env.explorerBaseUrl.replace(/\/$/, '')}/address/${address}`;
}

import {
  getAccount,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from '@wagmi/core';
import { parseAbi, type Hash } from 'viem';
import { env } from '@/config/env';
import { musdcFaucetAddress } from '@/config/contracts';
import { wagmiConfig } from '@/providers/wagmi';
import type { TxResult } from '@/services/types';
import { decodeTransactionError, TransactionGuardError } from './transactionPipeline';

export const MUSDC_CLAIM_AMOUNT = 10_000_000_000n;

export const musdcFaucetAbi = parseAbi([
  'function CLAIM_AMOUNT() view returns (uint256)',
  'function claim()',
  'function paused() view returns (bool)',
  'event Claimed(address indexed account, uint256 amount)',
]);

export async function claimMockUsdc(): Promise<TxResult> {
  try {
    if (!musdcFaucetAddress) {
      throw new Error('The Sepolia mUSDC faucet is not configured.');
    }

    const account = getAccount(wagmiConfig);
    if (!account.address || !account.isConnected) {
      throw new TransactionGuardError(
        'Connect a wallet from the account menu. Sign in first if needed.',
        'WALLET_REQUIRED',
      );
    }

    if (account.chainId !== env.chainId) {
      await switchChain(wagmiConfig, { chainId: env.chainId });
    }

    const simulation = await simulateContract(wagmiConfig, {
      account: account.address,
      address: musdcFaucetAddress,
      abi: musdcFaucetAbi,
      functionName: 'claim',
    });
    const hash = (await writeContract(wagmiConfig, simulation.request)) as Hash;
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
    if (receipt.status !== 'success') {
      throw new TransactionGuardError('The faucet transaction reverted.', 'CONTRACT_REVERTED');
    }

    window.dispatchEvent(new CustomEvent('dc:transaction-confirmed', { detail: { hash } }));
    return { hash, status: 'success' };
  } catch (error) {
    throw decodeTransactionError(error);
  }
}

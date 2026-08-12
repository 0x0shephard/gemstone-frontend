import {
  getAccount,
  getBalance,
  readContract,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from '@wagmi/core';
import {
  BaseError,
  ContractFunctionRevertedError,
  erc20Abi,
  type Abi,
  type Address,
  type Hash,
} from 'viem';
import { env } from '@/config/env';
import { NATIVE_ASSET } from '@/config/contracts';
import { wagmiConfig } from '@/providers/wagmi';
import { supabase } from '@/providers/supabase';
import { dgeNftAbi } from '@/contracts/abis';
import type { TxResult } from '@/services/types';

/**
 * Stages a write passes through, announced so the UI can say which one is
 * waiting.
 *
 * On a phone each wallet stage means leaving the browser for a wallet app and
 * coming back, and a token payment needs two of them. A single "Confirming…"
 * spinner covering all of it is indistinguishable from a hang — which is
 * exactly how it was reported.
 */
export type TransactionStep = 'checking' | 'approving' | 'awaiting-signature' | 'confirming';

export function announceStep(step: TransactionStep): void {
  window.dispatchEvent(new CustomEvent('dc:transaction-step', { detail: { step } }));
}

/**
 * Ceiling on waiting for a receipt.
 *
 * `waitForTransactionReceipt` has no default timeout, so a transaction that is
 * never mined leaves the button spinning forever with no hash on screen and no
 * way to find out what happened. Ten minutes is far longer than Sepolia needs
 * and short enough that a person is not left guessing.
 */
const RECEIPT_TIMEOUT_MS = 10 * 60 * 1_000;

export class TransactionGuardError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'AUTH_REQUIRED'
      | 'WALLET_REQUIRED'
      | 'WALLET_NOT_VERIFIED'
      | 'WRONG_WALLET'
      | 'INSUFFICIENT_BALANCE'
      | 'USER_REJECTED'
      | 'CONTRACT_REVERTED',
  ) {
    super(message);
    this.name = 'TransactionGuardError';
  }
}

export interface Approval {
  kind: 'erc20' | 'erc721';
  token: Address;
  spender: Address;
  amountOrTokenId: bigint;
}

interface ContractTransaction {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  paymentAsset?: Address;
  paymentAmount?: bigint;
  approvals?: Approval[];
}

async function requireVerifiedWallet(): Promise<Address> {
  if (!supabase) {
    throw new TransactionGuardError(
      'Authentication is not configured. Chain transactions are disabled.',
      'AUTH_REQUIRED',
    );
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new TransactionGuardError('Sign in before submitting a transaction.', 'AUTH_REQUIRED');
  }

  const account = getAccount(wagmiConfig);
  if (!account.address || !account.isConnected) {
    throw new TransactionGuardError('Connect a wallet to continue.', 'WALLET_REQUIRED');
  }

  const { data: walletLink, error } = await supabase
    .from('wallet_links')
    .select('wallet_address')
    .eq('profile_id', session.user.id)
    .eq('wallet_address', account.address.toLowerCase())
    .eq('is_primary', true)
    .not('verified_at', 'is', null)
    .maybeSingle();

  if (error || !walletLink) {
    throw new TransactionGuardError(
      'Verify this wallet with Sign-In with Ethereum before transacting.',
      'WALLET_NOT_VERIFIED',
    );
  }
  return account.address;
}

async function ensureChain(): Promise<void> {
  const account = getAccount(wagmiConfig);
  if (account.chainId !== env.chainId) {
    await switchChain(wagmiConfig, { chainId: env.chainId });
  }
}

async function ensureFunds(
  account: Address,
  asset: Address | undefined,
  amount: bigint | undefined,
): Promise<void> {
  if (!asset || amount === undefined || amount === 0n) return;
  const balance =
    asset === NATIVE_ASSET
      ? (await getBalance(wagmiConfig, { address: account })).value
      : ((await readContract(wagmiConfig, {
          address: asset,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account],
        })) as bigint);
  if (balance < amount) {
    throw new TransactionGuardError('Insufficient payment-asset balance.', 'INSUFFICIENT_BALANCE');
  }
}

async function submitApproval(account: Address, approval: Approval): Promise<void> {
  if (approval.kind === 'erc20') {
    const allowance = (await readContract(wagmiConfig, {
      address: approval.token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account, approval.spender],
    })) as bigint;
    if (allowance >= approval.amountOrTokenId) return;
    const simulation = await simulateContract(wagmiConfig, {
      account,
      address: approval.token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [approval.spender, approval.amountOrTokenId],
    });
    const hash = await writeContract(wagmiConfig, simulation.request);
    await waitForTransactionReceipt(wagmiConfig, { hash });
    return;
  }

  const approved = (await readContract(wagmiConfig, {
    address: approval.token,
    abi: dgeNftAbi,
    functionName: 'getApproved',
    args: [approval.amountOrTokenId],
  })) as Address;
  if (approved.toLowerCase() === approval.spender.toLowerCase()) return;
  const simulation = await simulateContract(wagmiConfig, {
    account,
    address: approval.token,
    abi: dgeNftAbi,
    functionName: 'approve',
    args: [approval.spender, approval.amountOrTokenId],
  });
  const hash = await writeContract(wagmiConfig, simulation.request);
  await waitForTransactionReceipt(wagmiConfig, { hash });
}

export function decodeTransactionError(error: unknown): Error {
  if (error instanceof TransactionGuardError) return error;
  if (error instanceof BaseError) {
    const reverted = error.walk(
      (candidate) => candidate instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError | null;
    if (reverted) {
      const reason = reverted.data?.errorName ?? reverted.reason ?? 'Contract transaction reverted';
      return new TransactionGuardError(reason, 'CONTRACT_REVERTED');
    }
    if (/rejected|denied/i.test(error.shortMessage)) {
      return new TransactionGuardError('Signature or transaction rejected.', 'USER_REJECTED');
    }
    return new Error(error.shortMessage);
  }
  return error instanceof Error ? error : new Error('Transaction failed');
}

export async function runContractTransaction(input: ContractTransaction): Promise<TxResult> {
  try {
    announceStep('checking');
    const account = await requireVerifiedWallet();
    await ensureChain();
    await ensureFunds(account, input.paymentAsset, input.paymentAmount);
    for (const approval of input.approvals ?? []) {
      announceStep('approving');
      await submitApproval(account, approval);
    }

    announceStep('awaiting-signature');
    const simulation = await simulateContract(wagmiConfig, {
      account,
      address: input.address,
      abi: input.abi,
      functionName: input.functionName,
      args: input.args,
      value: input.value,
    });
    const hash = (await writeContract(wagmiConfig, simulation.request)) as Hash;
    announceStep('confirming');
    const receipt = await waitForTransactionReceipt(wagmiConfig, {
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
    }).catch(() => {
      // The transaction may still land later; it is the waiting that ended, not
      // necessarily the transaction. Hand back the hash so it can be followed.
      throw new TransactionGuardError(
        `Still unconfirmed after 10 minutes. Track it on the explorer: ${hash}`,
        'CONTRACT_REVERTED',
      );
    });
    if (receipt.status !== 'success') {
      throw new TransactionGuardError('Transaction reverted.', 'CONTRACT_REVERTED');
    }
    window.dispatchEvent(new CustomEvent('dc:transaction-confirmed', { detail: { hash } }));
    return { hash, status: 'success' };
  } catch (error) {
    throw decodeTransactionError(error);
  }
}

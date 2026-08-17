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
  WaitForTransactionReceiptTimeoutError,
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
import { BroadcastPendingError, announceStep, awaitGesture } from './txSteps';
import {
  closeWork,
  openWork,
  recordBroadcast,
  recordStepStatus,
  type PendingStep,
} from './pendingWork';

/**
 * Ceiling on waiting for a receipt.
 *
 * `waitForTransactionReceipt` has no default timeout, so a transaction that is
 * never mined leaves the button spinning forever with no hash on screen and no
 * way to find out what happened. Ten minutes is far longer than Sepolia needs
 * and short enough that a person is not left guessing.
 */
const RECEIPT_TIMEOUT_MS = 10 * 60 * 1_000;

export { BroadcastPendingError, announceStep, setStepGate } from './txSteps';
export type { StepPrompt, TransactionStep } from './txSteps';

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
      | 'CONTRACT_REVERTED'
      /** The allowance or token approval itself reverted, before the main call. */
      | 'APPROVAL_REVERTED',
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

/**
 * Whether an approval is actually needed, and what it would be.
 *
 * Read entirely in the browser, before any wallet is opened. Knowing the whole
 * list of wallet requests up front is what lets the UI say "step 1 of 2" rather
 * than discovering a second signature after the first has been given.
 */
async function planApproval(
  account: Address,
  approval: Approval,
): Promise<{ label: string; send: () => Promise<Hash> } | undefined> {
  if (approval.kind === 'erc20') {
    const allowance = (await readContract(wagmiConfig, {
      address: approval.token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account, approval.spender],
    })) as bigint;
    if (allowance >= approval.amountOrTokenId) return undefined;
    return {
      label: 'Approve the payment allowance',
      send: async () => {
        const simulation = await simulateContract(wagmiConfig, {
          account,
          address: approval.token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [approval.spender, approval.amountOrTokenId],
        });
        return (await writeContract(wagmiConfig, simulation.request)) as Hash;
      },
    };
  }

  const approved = (await readContract(wagmiConfig, {
    address: approval.token,
    abi: dgeNftAbi,
    functionName: 'getApproved',
    args: [approval.amountOrTokenId],
  })) as Address;
  if (approved.toLowerCase() === approval.spender.toLowerCase()) return undefined;
  return {
    label: 'Approve the gemstone transfer',
    send: async () => {
      const simulation = await simulateContract(wagmiConfig, {
        account,
        address: approval.token,
        abi: dgeNftAbi,
        functionName: 'approve',
        args: [approval.spender, approval.amountOrTokenId],
      });
      return (await writeContract(wagmiConfig, simulation.request)) as Hash;
    },
  };
}

/**
 * Runs one wallet request: gesture, broadcast, record, confirm.
 *
 * The order is the point. The hash is written to storage between `writeContract`
 * resolving and anything being awaited, so a browser suspended while the wallet
 * app is in front still knows, on return, that a transaction exists. Losing that
 * is what let the UI offer a retry on work that had already succeeded.
 */
async function runStep(
  workId: string,
  index: number,
  total: number,
  step: { kind: 'approval' | 'call'; label: string; send: () => Promise<Hash> },
): Promise<Hash> {
  await awaitGesture({ index, total, label: step.label, kind: step.kind });

  announceStep(step.kind === 'approval' ? 'approving' : 'awaiting-signature');
  const hash = await step.send();
  recordBroadcast(workId, index, hash);

  announceStep('confirming');
  let receipt;
  try {
    receipt = await waitForTransactionReceipt(wagmiConfig, { hash, timeout: RECEIPT_TIMEOUT_MS });
  } catch (waitError) {
    /*
     * Broadcast, outcome unknown. Every branch here keeps the hash and leaves
     * the record open: a timeout, a dropped RPC and a backgrounded tab are
     * indistinguishable from here, and all three describe a transaction that may
     * well succeed. Reporting a plain failure — which is what happened before,
     * for everything except a timeout — invited a second attempt at work already
     * in flight.
     */
    const reason =
      waitError instanceof WaitForTransactionReceiptTimeoutError
        ? 'It has not confirmed yet'
        : 'The connection dropped while waiting';
    throw new BroadcastPendingError(
      `${reason}, but the transaction was sent. It will be checked when you return — do not send it again.`,
      hash,
      workId,
    );
  }

  if (receipt.status !== 'success') {
    recordStepStatus(workId, index, 'failed');
    throw new TransactionGuardError(
      step.kind === 'approval'
        ? 'The approval transaction reverted, so the transfer was not attempted.'
        : 'Transaction reverted.',
      step.kind === 'approval' ? 'APPROVAL_REVERTED' : 'CONTRACT_REVERTED',
    );
  }
  recordStepStatus(workId, index, 'confirmed');
  return hash;
}

/**
 * `ERC20InsufficientAllowance(address,uint256,uint256)`, OpenZeppelin's.
 *
 * Recorded as a selector because the ERC-20 ABI used here declares functions
 * only, so viem has nothing to decode the custom error against and surfaces the
 * four bytes verbatim.
 */
const ERC20_INSUFFICIENT_ALLOWANCE = '0xfb8f41b2';

export function decodeTransactionError(error: unknown): Error {
  if (error instanceof TransactionGuardError) return error;
  // Carries a hash, and must reach the UI intact — losing it here would put the
  // caller back where it started, offering a retry on a live transaction.
  if (error instanceof BroadcastPendingError) return error;
  if (error instanceof BaseError) {
    const reverted = error.walk(
      (candidate) => candidate instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError | null;
    if (reverted) {
      /*
       * A raw selector is not an explanation.
       *
       * `ERC20InsufficientAllowance` is not in the ABI these calls are decoded
       * against, so it arrived as an undecodable four-byte signature and was
       * reported as "Contract transaction reverted" — which describes every
       * revert there is and points at nothing. It is the one revert a person can
       * actually act on, so it is named.
       */
      const selector = reverted.signature ?? reverted.data?.errorName;
      if (selector === ERC20_INSUFFICIENT_ALLOWANCE) {
        return new TransactionGuardError(
          'The token allowance is not in place yet. Approve the payment asset and try again.',
          'APPROVAL_REVERTED',
        );
      }
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
  let work: { id: string } | undefined;
  try {
    /*
     * Everything that can be settled without the wallet happens first.
     *
     * Checks, allowance reads and the simulation all run while the browser is in
     * the foreground, so by the time anyone is asked to open a wallet the
     * request is fully formed and the number of signatures is known. Previously
     * the second signature was discovered only after the first had been given,
     * and was built while the tab was in the background — which is why the
     * wallet opened with nothing to show.
     */
    announceStep('checking');
    const account = await requireVerifiedWallet();
    await ensureChain();
    await ensureFunds(account, input.paymentAsset, input.paymentAmount);

    const planned: { kind: 'approval' | 'call'; label: string; send: () => Promise<Hash> }[] = [];
    for (const approval of input.approvals ?? []) {
      const step = await planApproval(account, approval);
      if (step) planned.push({ kind: 'approval', ...step });
    }

    const simulateCall = () =>
      simulateContract(wagmiConfig, {
        account,
        address: input.address,
        abi: input.abi,
        functionName: input.functionName,
        args: input.args,
        value: input.value,
      });

    /*
     * Simulated up front only when nothing has to be approved first.
     *
     * A call that spends an ERC-20 cannot be simulated before its allowance
     * exists — the simulation reverts on the transfer, which is not a fault in
     * the call but a description of the order things happen in. Simulating
     * regardless meant a wallet paying with a token for the first time was
     * refused before it was asked to sign anything, and the failure surfaced as
     * "Contract transaction reverted" with no wallet prompt at all. Wallets that
     * had approved once in the past were unaffected, which is why this survived:
     * the allowance they already held made the simulation pass.
     *
     * Where there is no approval, the early simulation is kept — refusing before
     * a signature is better than after one.
     */
    const needsApprovalFirst = planned.length > 0;
    const simulation = needsApprovalFirst ? undefined : await simulateCall();

    planned.push({
      kind: 'call',
      label: needsApprovalFirst ? 'Confirm the transaction' : 'Confirm in your wallet',
      send: async () => {
        // Simulated here when approvals came first, so the allowance granted by
        // the step above is in place and the simulation describes reality.
        const request = (simulation ?? (await simulateCall())).request;
        return (await writeContract(wagmiConfig, request)) as Hash;
      },
    });

    const opened = openWork({
      flow: input.functionName,
      label: input.functionName,
      account,
      chainId: env.chainId,
      steps: planned.map<PendingStep>((step) => ({
        kind: step.kind,
        label: step.label,
        status: 'waiting',
      })),
    });
    work = opened;

    let last: Hash | undefined;
    for (const [index, step] of planned.entries()) {
      last = await runStep(opened.id, index, planned.length, step);
    }

    // Only once every step confirmed. A record left open is a record something
    // still has to reconcile, which is exactly the state we want to keep.
    closeWork(opened.id);
    window.dispatchEvent(new CustomEvent('dc:transaction-confirmed', { detail: { hash: last } }));
    return { hash: last!, status: 'success' };
  } catch (error) {
    /*
     * A broadcast that has not resolved keeps its record. Anything else never
     * reached the chain, so the record is noise and would offer a resume for
     * work that does not exist.
     */
    if (!(error instanceof BroadcastPendingError) && work) closeWork(work.id);
    throw decodeTransactionError(error);
  }
}

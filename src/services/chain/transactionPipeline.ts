import {
  getAccount,
  getBalance,
  getBlockNumber,
  getPublicClient,
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
  encodeFunctionData,
  erc20Abi,
  parseAbiItem,
  toHex,
  type Abi,
  type Address,
  type Hash,
  type PublicClient,
} from 'viem';
import { env } from '@/config/env';
import { activeChain } from '@/config/chains';
import { NATIVE_ASSET } from '@/config/contracts';
import { wagmiConfig } from '@/providers/wagmi';
import { supabase } from '@/providers/supabase';
import { dgeNftAbi } from '@/contracts/abis';
import type { TxResult } from '@/services/types';
import {
  BroadcastPendingError,
  BroadcastOutcomeUnknownError,
  WalletResponseTimeoutError,
  announceStep,
  awaitGesture,
  captureStepGate,
  type StepGateLease,
} from './txSteps';
import {
  closeWork,
  findPendingBroadcast,
  openWork,
  recordBroadcast,
  recordUnknownBroadcast,
  recordStepStatus,
  type PendingStep,
  type PendingWork,
} from './pendingWork';
import { paymentApprovalAmounts } from './approvalPlan';
import { getTransactionAuthSnapshot } from '@/providers/authSnapshot';
import { PreflightTimeoutError, withPreflightTimeout } from './preflight';
import {
  isAmbiguousWalletBroadcastError,
  recoverAmbiguousWalletBroadcast,
  WALLET_NETWORK_FAILURE_MESSAGE,
} from './walletRpcRecovery';
import {
  isWalletConnectConnector,
  requestWalletConnectTransaction,
  walletConnectSupportsChain,
  type WalletConnectProviderLike,
} from './walletConnectRouting';

/**
 * Ceiling on waiting for a receipt.
 *
 * `waitForTransactionReceipt` has no default timeout, so a transaction that is
 * never mined leaves the button spinning forever with no hash on screen and no
 * way to find out what happened. Ten minutes is far longer than Sepolia needs
 * and short enough that a person is not left guessing.
 */
const RECEIPT_TIMEOUT_MS = 10 * 60 * 1_000;
/** A wallet request must resolve or fail; it may not leave the app spinning forever. */
const WALLET_RESPONSE_TIMEOUT_MS = 2 * 60 * 1_000;
const AUTH_PREFLIGHT_TIMEOUT_MS = 12_000;
const CHAIN_PREFLIGHT_TIMEOUT_MS = 20_000;
const erc20ApprovalEvent = parseAbiItem(
  'event Approval(address indexed owner,address indexed spender,uint256 value)',
);
const erc721ApprovalEvent = parseAbiItem(
  'event Approval(address indexed owner,address indexed approved,uint256 indexed tokenId)',
);

export {
  BroadcastOutcomeUnknownError,
  BroadcastPendingError,
  announceStep,
  acquireStepGate,
} from './txSteps';
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
  /** Stable semantic identity that must not contain a mutable quote or shortfall. */
  intentKey?: string;
  /** Find a write that landed even though the mobile wallet lost its RPC response. */
  reconcileBroadcast?: (
    account: Address,
    fromBlock?: bigint,
    expectedOperationKey?: string,
  ) => Promise<Hash | undefined>;
}

/** Exact, stable identity for one value-moving contract call. */
export function operationFingerprint(input: ContractTransaction): string {
  const data = encodeFunctionData({
    abi: input.abi,
    functionName: input.functionName,
    args: input.args,
  } as never);
  return `${input.address.toLowerCase()}:${data.toLowerCase()}:${input.value ?? 0n}`;
}

async function requireVerifiedWallet(): Promise<Address> {
  if (!supabase) {
    throw new TransactionGuardError(
      'Authentication is not configured. Chain transactions are disabled.',
      'AUTH_REQUIRED',
    );
  }
  const account = getAccount(wagmiConfig);
  if (!account.address || !account.isConnected) {
    throw new TransactionGuardError('Connect a wallet to continue.', 'WALLET_REQUIRED');
  }

  /*
   * AuthProvider already loaded this server-verified link for the visible UI.
   * Reusing it removes a redundant Supabase round trip from the most fragile
   * part of a mobile flow: immediately after returning from MetaMask.
   */
  const auth = getTransactionAuthSnapshot();
  if (
    !auth.loading &&
    auth.userId &&
    auth.linkedWallet?.toLowerCase() === account.address.toLowerCase()
  ) {
    return account.address;
  }

  const {
    data: { session },
  } = await withPreflightTimeout(
    supabase.auth.getSession(),
    'The signed-in session check did not respond. Refresh this page and try again; no transaction was sent.',
    AUTH_PREFLIGHT_TIMEOUT_MS,
  );
  if (!session) {
    throw new TransactionGuardError('Sign in before submitting a transaction.', 'AUTH_REQUIRED');
  }

  const { data: walletLink, error } = await withPreflightTimeout(
    supabase
      .from('wallet_links')
      .select('wallet_address')
      .eq('profile_id', session.user.id)
      .eq('wallet_address', account.address.toLowerCase())
      .eq('is_primary', true)
      .not('verified_at', 'is', null)
      .maybeSingle(),
    'The wallet verification check did not respond. Refresh this page and try again; no transaction was sent.',
    AUTH_PREFLIGHT_TIMEOUT_MS,
  );

  if (error || !walletLink) {
    throw new TransactionGuardError(
      'Verify this wallet with Sign-In with Ethereum before transacting.',
      'WALLET_NOT_VERIFIED',
    );
  }
  return account.address;
}

async function ensureChain(gestureGate: StepGateLease | null): Promise<void> {
  const account = getAccount(wagmiConfig);
  if (account.chainId === env.chainId) return;

  if (isWalletConnectConnector(account.connector) && account.connector?.getProvider) {
    const provider = (await withPreflightTimeout(
      account.connector.getProvider(),
      'The wallet session did not respond. Reopen the wallet and return here; no transaction was sent.',
      CHAIN_PREFLIGHT_TIMEOUT_MS,
    )) as WalletConnectProviderLike;
    if (walletConnectSupportsChain(provider, env.chainId)) return;
    throw new TransactionGuardError(
      `Reconnect the wallet and approve ${activeChain.name} when asked. The current WalletConnect session did not authorise it.`,
      'WRONG_WALLET',
    );
  }

  /*
   * A chain switch is a wallet interaction, not a read-only preflight check.
   * Starting it after awaited auth work meant the original button gesture was
   * gone by the time iOS tried to open MetaMask, so WalletConnect waited for a
   * response to a request the wallet never displayed. Give it its own fresh tap
   * exactly like approvals and contract calls.
   */
  await awaitGesture(
    {
      index: 0,
      total: 1,
      label: `Switch wallet to ${activeChain.name}`,
      kind: 'network',
    },
    gestureGate,
  );
  announceStep('switching-network');
  const switched = await withPreflightTimeout(
    switchChain(wagmiConfig, { chainId: env.chainId }),
    `The wallet did not finish switching to ${activeChain.name}. Reopen the wallet, select ${activeChain.name}, and try again; no transaction was sent.`,
    WALLET_RESPONSE_TIMEOUT_MS,
  );
  if (switched.id !== env.chainId) {
    throw new TransactionGuardError(
      `Switch the connected wallet to ${activeChain.name} before continuing.`,
      'WRONG_WALLET',
    );
  }
}

interface PreparedWrite {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  chainId?: number;
}

/** Prepare routing before the tap, then return the wallet request itself. */
async function prepareWriteSubmission(
  account: Address,
  request: PreparedWrite,
): Promise<() => Promise<Hash>> {
  const connector = getAccount(wagmiConfig).connector;
  if (!isWalletConnectConnector(connector) || !connector?.getProvider) {
    return async () =>
      (await writeContract(wagmiConfig, {
        ...request,
        chainId: env.chainId,
      } as never)) as Hash;
  }

  const provider = (await withPreflightTimeout(
    connector.getProvider(),
    'The wallet session did not respond. Reopen the wallet and return here; no transaction was sent.',
    CHAIN_PREFLIGHT_TIMEOUT_MS,
  )) as WalletConnectProviderLike;
  const data = encodeFunctionData({
    abi: request.abi,
    functionName: request.functionName,
    args: request.args,
  } as never);
  return () =>
    requestWalletConnectTransaction(provider, env.chainId, {
      from: account,
      to: request.address,
      data,
      ...(request.value && request.value > 0n ? { value: toHex(request.value) } : {}),
    });
}

async function ensureFunds(
  account: Address,
  asset: Address | undefined,
  amount: bigint | undefined,
): Promise<void> {
  if (!asset || amount === undefined || amount === 0n) return;
  const balance =
    asset === NATIVE_ASSET
      ? (await getBalance(wagmiConfig, { address: account, chainId: env.chainId })).value
      : ((await readContract(wagmiConfig, {
          chainId: env.chainId,
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
): Promise<
  {
    label: string;
    prepare: () => Promise<() => Promise<Hash>>;
    reconcile: () => Promise<Hash | undefined>;
  }[]
> {
  if (approval.kind === 'erc20') {
    const allowance = (await readContract(wagmiConfig, {
      chainId: env.chainId,
      address: approval.token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account, approval.spender],
    })) as bigint;
    if (allowance >= approval.amountOrTokenId) return [];
    const fromBlock = await getBlockNumber(wagmiConfig, { chainId: env.chainId });
    const approvalStep = (amount: bigint, label: string) => ({
      label,
      prepare: async () => {
        const simulation = await simulateContract(wagmiConfig, {
          chainId: env.chainId,
          account,
          address: approval.token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [approval.spender, amount],
        });
        return prepareWriteSubmission(account, simulation.request);
      },
      reconcile: async () => {
        const current = (await readContract(wagmiConfig, {
          chainId: env.chainId,
          address: approval.token,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [account, approval.spender],
        })) as bigint;
        if (amount === 0n ? current !== 0n : current < amount) return;
        const publicClient = getPublicClient(wagmiConfig, {
          chainId: env.chainId,
        }) as PublicClient;
        const logs = await publicClient.getLogs({
          address: approval.token,
          event: erc20ApprovalEvent,
          args: { owner: account, spender: approval.spender },
          fromBlock,
          toBlock: 'latest',
        });
        return [...logs]
          .reverse()
          .find((log) =>
            amount === 0n ? (log.args.value ?? 0n) === 0n : (log.args.value ?? 0n) >= amount,
          )?.transactionHash;
      },
    });

    return paymentApprovalAmounts(allowance, approval.amountOrTokenId).map((amount) =>
      approvalStep(
        amount,
        amount === 0n ? 'Reset the existing token allowance' : 'Approve the payment allowance',
      ),
    );
  }

  const approved = (await readContract(wagmiConfig, {
    chainId: env.chainId,
    address: approval.token,
    abi: dgeNftAbi,
    functionName: 'getApproved',
    args: [approval.amountOrTokenId],
  })) as Address;
  if (approved.toLowerCase() === approval.spender.toLowerCase()) return [];
  const fromBlock = await getBlockNumber(wagmiConfig, { chainId: env.chainId });
  return [
    {
      label: 'Approve the gemstone transfer',
      prepare: async () => {
        const simulation = await simulateContract(wagmiConfig, {
          chainId: env.chainId,
          account,
          address: approval.token,
          abi: dgeNftAbi,
          functionName: 'approve',
          args: [approval.spender, approval.amountOrTokenId],
        });
        return prepareWriteSubmission(account, simulation.request);
      },
      reconcile: async () => {
        const current = (await readContract(wagmiConfig, {
          chainId: env.chainId,
          address: approval.token,
          abi: dgeNftAbi,
          functionName: 'getApproved',
          args: [approval.amountOrTokenId],
        })) as Address;
        if (current.toLowerCase() !== approval.spender.toLowerCase()) return;
        const publicClient = getPublicClient(wagmiConfig, {
          chainId: env.chainId,
        }) as PublicClient;
        const logs = await publicClient.getLogs({
          address: approval.token,
          event: erc721ApprovalEvent,
          args: {
            owner: account,
            approved: approval.spender,
            tokenId: approval.amountOrTokenId,
          },
          fromBlock,
          toBlock: 'latest',
        });
        return [...logs].reverse().find((log) => log.transactionHash)?.transactionHash;
      },
    },
  ];
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
  step: {
    kind: 'approval' | 'call';
    label: string;
    prepare: () => Promise<() => Promise<Hash>>;
    reconcile?: () => Promise<Hash | undefined>;
  },
  gestureGate: StepGateLease | null,
): Promise<Hash> {
  // Finish every public RPC operation before advertising a tappable wallet
  // step. The final gesture now leads directly to the wallet request instead of
  // being consumed by a simulation that can stall while the app switch expires.
  announceStep('checking');
  const send = await withPreflightTimeout(
    step.prepare(),
    'The transaction safety check did not respond. Check your connection and try again; no transaction was sent.',
    CHAIN_PREFLIGHT_TIMEOUT_MS,
  );
  await awaitGesture({ index, total, label: step.label, kind: step.kind }, gestureGate);

  announceStep(step.kind === 'approval' ? 'approving' : 'awaiting-signature');
  let timeoutId: number | undefined;
  const walletTimeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new WalletResponseTimeoutError()),
      WALLET_RESPONSE_TIMEOUT_MS,
    );
  });
  let hash: Hash;
  try {
    try {
      hash = await Promise.race([send(), walletTimeout]);
    } catch (sendError) {
      const recovered = step.reconcile
        ? await recoverAmbiguousWalletBroadcast(sendError, step.reconcile)
        : undefined;
      if (!recovered) {
        if (
          sendError instanceof WalletResponseTimeoutError ||
          isAmbiguousWalletBroadcastError(sendError)
        ) {
          recordUnknownBroadcast(workId, index);
          throw new BroadcastOutcomeUnknownError(WALLET_NETWORK_FAILURE_MESSAGE, workId);
        }
        throw sendError;
      }
      hash = recovered;
    }
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
  recordBroadcast(workId, index, hash);

  announceStep('confirming');
  let receipt;
  try {
    receipt = await waitForTransactionReceipt(wagmiConfig, {
      chainId: env.chainId,
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
    });
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
  if (error instanceof BroadcastOutcomeUnknownError) return error;
  if (error instanceof WalletResponseTimeoutError) return error;
  if (error instanceof PreflightTimeoutError) return error;
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
      if (selector === '0x177e802f' || reverted.data?.errorName === 'ERC721InsufficientApproval') {
        return new TransactionGuardError(
          'The gemstone transfer is not approved yet. Approve the escrow contract and continue.',
          'APPROVAL_REVERTED',
        );
      }
      const errorName = reverted.data?.errorName;
      const reason =
        errorName === 'Expired'
          ? 'This offer has expired and can no longer be accepted.'
          : errorName === 'InvalidOffer'
            ? 'This offer is no longer open. Refresh the list to see its current state.'
            : (errorName ?? reverted.reason ?? 'Contract transaction reverted');
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
  const gestureGate = captureStepGate();
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
    const operationKey = operationFingerprint(input);
    const intentKey = input.intentKey ?? operationKey;
    await ensureChain(gestureGate);
    await withPreflightTimeout(
      ensureFunds(account, input.paymentAsset, input.paymentAmount),
      'The balance check did not respond. Check your connection and try again; no transaction was sent.',
      CHAIN_PREFLIGHT_TIMEOUT_MS,
    );

    const planned: {
      kind: 'approval' | 'call';
      label: string;
      prepare: () => Promise<() => Promise<Hash>>;
      reconcile?: () => Promise<Hash | undefined>;
    }[] = [];
    for (const approval of input.approvals ?? []) {
      const steps = await withPreflightTimeout(
        planApproval(account, approval),
        'The approval check did not respond. Check your connection and try again; no transaction was sent.',
        CHAIN_PREFLIGHT_TIMEOUT_MS,
      );
      planned.push(...steps.map((step) => ({ kind: 'approval' as const, ...step })));
    }

    let unresolved = findPendingBroadcast(intentKey, account, env.chainId);
    if (unresolved) {
      const settled = await settleStaleWork(unresolved, account, input.reconcileBroadcast);
      if (settled.kind === 'landed') {
        closeWork(unresolved.id);
        window.dispatchEvent(
          new CustomEvent('dc:transaction-confirmed', { detail: { hash: settled.hash } }),
        );
        return { hash: settled.hash, status: 'success' };
      }
      if (settled.kind === 'clear') {
        // Proven not to be in flight: the earlier attempt never landed.
        closeWork(unresolved.id);
        unresolved = undefined;
      }
    }
    if (unresolved) {
      const unknownStep = unresolved.steps.find(
        (step) => step.status === 'broadcast' && !step.hash,
      );
      if (unknownStep?.kind === 'approval') {
        // Approvals move no funds. Whether the old approval landed (and is now
        // sufficient) or did not land / is too small for a changed quote, the
        // freshly planned approval state is authoritative and safe to execute.
        closeWork(unresolved.id);
      } else if (unknownStep?.kind === 'call' && input.reconcileBroadcast) {
        const observed = await input.reconcileBroadcast(
          account,
          unresolved.fromBlock ? BigInt(unresolved.fromBlock) : undefined,
          unresolved.operationKey,
        );
        if (observed) {
          closeWork(unresolved.id);
          window.dispatchEvent(
            new CustomEvent('dc:transaction-confirmed', { detail: { hash: observed } }),
          );
          return { hash: observed, status: 'success' };
        }
        throw new BroadcastOutcomeUnknownError(
          'A previous transaction for this exact action may still be on chain. Do not submit it again until its chain outcome can be verified.',
          unresolved.id,
        );
      } else {
        throw new BroadcastOutcomeUnknownError(
          'A previous transaction for this exact action may still be on chain. Do not submit it again until wallet activity or chain reconciliation resolves it.',
          unresolved.id,
        );
      }
    }

    const simulateCall = () =>
      simulateContract(wagmiConfig, {
        chainId: env.chainId,
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
    const simulation = needsApprovalFirst
      ? undefined
      : await withPreflightTimeout(
          simulateCall(),
          'The transaction safety check did not respond. Check your connection and try again; no transaction was sent.',
          CHAIN_PREFLIGHT_TIMEOUT_MS,
        );

    planned.push({
      kind: 'call',
      label: needsApprovalFirst ? 'Confirm the transaction' : 'Confirm in your wallet',
      reconcile: input.reconcileBroadcast
        ? () => input.reconcileBroadcast!(account, undefined, operationKey)
        : undefined,
      prepare: async () => {
        // Simulated here when approvals came first, so the allowance granted by
        // the step above is in place and the simulation describes reality.
        const request = (
          simulation ??
          (await withPreflightTimeout(
            simulateCall(),
            'The transaction safety check did not respond. Check your connection and try again; no transaction was sent.',
            CHAIN_PREFLIGHT_TIMEOUT_MS,
          ))
        ).request;
        return prepareWriteSubmission(account, request);
      },
    });

    const fromBlock = await withPreflightTimeout(
      getBlockNumber(wagmiConfig, { chainId: env.chainId }),
      'The chain status check did not respond. Check your connection and try again; no transaction was sent.',
      CHAIN_PREFLIGHT_TIMEOUT_MS,
    );
    const opened = openWork({
      flow: input.functionName,
      label: input.functionName,
      account,
      chainId: env.chainId,
      operationKey,
      intentKey,
      fromBlock: fromBlock.toString(),
      steps: planned.map<PendingStep>((step) => ({
        kind: step.kind,
        label: step.label,
        status: 'waiting',
      })),
    });
    work = opened;

    let last: Hash | undefined;
    for (const [index, step] of planned.entries()) {
      last = await runStep(opened.id, index, planned.length, step, gestureGate);
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
    if (
      !(error instanceof BroadcastPendingError) &&
      !(error instanceof BroadcastOutcomeUnknownError) &&
      work
    )
      closeWork(work.id);
    throw decodeTransactionError(error);
  }
}

/** Below this age a send may simply not have reached the node yet. */
const STALE_WORK_MIN_AGE_MS = 60_000;

type SettledWork = { kind: 'landed'; hash: Hash } | { kind: 'clear' } | { kind: 'pending' };

/**
 * Decides whether an earlier attempt at the same action still blocks a new one.
 *
 * The lock exists so an unknown send is never paid twice, but nothing ever
 * released it when the answer was "that send did not happen": a transaction the
 * wallet dropped or replaced has no receipt, and a hashless send whose effect is
 * not on chain was re-locked on every attempt. People were left with actions
 * refusing forever. The outcome is now settled from chain facts:
 *
 * - a successful receipt means it landed, and the action is already done;
 * - a reverted receipt, or a hash the node no longer knows, means it did not;
 * - with no hash, the flow's own reconciliation looks for its effect, and if
 *   that is absent while the wallet has no pending transaction at all
 *   (pending nonce equals latest), nothing can still be in flight.
 *
 * Anything younger than a minute, or with a pending nonce outstanding, stays
 * locked exactly as before.
 */
async function settleStaleWork(
  work: PendingWork,
  account: Address,
  reconcile?: (
    account: Address,
    fromBlock: bigint | undefined,
    operationKey: string | undefined,
  ) => Promise<Hash | undefined>,
): Promise<SettledWork> {
  const client = getPublicClient(wagmiConfig, { chainId: env.chainId });
  if (!client) return { kind: 'pending' };
  try {
    const calls = work.steps.filter((step) => step.status === 'broadcast');
    for (const step of calls) {
      if (!step.hash) continue;
      const receipt = await client.getTransactionReceipt({ hash: step.hash }).catch(() => null);
      if (receipt?.status === 'success' && step.kind === 'call') {
        return { kind: 'landed', hash: step.hash };
      }
      if (receipt) continue; // an approval, or a revert: not this action's effect
      const known = await client.getTransaction({ hash: step.hash }).catch(() => null);
      if (known) return { kind: 'pending' };
    }
    if (Date.now() - work.createdAt < STALE_WORK_MIN_AGE_MS) return { kind: 'pending' };
    const hashless = calls.some((step) => step.kind === 'call' && !step.hash);
    if (hashless && reconcile) {
      const observed = await reconcile(
        account,
        work.fromBlock ? BigInt(work.fromBlock) : undefined,
        work.operationKey,
      );
      if (observed) return { kind: 'landed', hash: observed };
    }
    const [pendingNonce, latestNonce] = await Promise.all([
      client.getTransactionCount({ address: account, blockTag: 'pending' }),
      client.getTransactionCount({ address: account, blockTag: 'latest' }),
    ]);
    return pendingNonce > latestNonce ? { kind: 'pending' } : { kind: 'clear' };
  } catch {
    return { kind: 'pending' };
  }
}

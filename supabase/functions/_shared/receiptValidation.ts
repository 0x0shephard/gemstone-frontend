/**
 * Receipt checks for RedemptionManager transactions.
 *
 * A server-signed step comes from an EOA calling the manager directly, so its
 * envelope (`to`, `from`) is exact. A person's step may not be: a Safe executes
 * through `execTransaction` (`to` = the Safe, `from` = whichever owner paid gas)
 * and an ERC-4337 account through the EntryPoint (`from` = a bundler). For those
 * the manager's own events are the evidence: they are filtered to the manager's
 * address, and wherever the contract records `msg.sender` (proposer, approver,
 * opener) that argument must be the acting wallet.
 */

/** keccak256("ExecutionSuccess(bytes32,uint256)"), emitted by a Safe when `execTransaction` succeeds. */
export const SAFE_EXECUTION_SUCCESS_TOPIC =
  '0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e';

export interface RawReceiptLog {
  address: string;
  topics: readonly (string | null)[];
}

export interface ParsedManagerLog {
  address: string;
  eventName: string;
  args: unknown;
}

const same = (left: unknown, right: unknown) =>
  String(left).toLowerCase() === String(right).toLowerCase();

export function assertReceiptOutcome(input: {
  chainId: number;
  expectedChainId: number;
  status: string;
}): void {
  if (input.chainId !== input.expectedChainId) {
    throw new Error('Transaction RPC is on the wrong chain');
  }
  if (input.status !== 'success') {
    throw new Error('Transaction did not successfully call the redemption manager');
  }
}

export function assertReceiptEnvelope(input: {
  chainId: number;
  expectedChainId: number;
  status: string;
  to: string | null;
  manager: string;
  from: string;
  expectedSender?: string;
}): void {
  assertReceiptOutcome(input);
  if (!input.to || input.to.toLowerCase() !== input.manager.toLowerCase()) {
    throw new Error('Transaction did not successfully call the redemption manager');
  }
  if (input.expectedSender && input.from.toLowerCase() !== input.expectedSender.toLowerCase()) {
    throw new Error('Transaction sender does not match the verified acting wallet');
  }
}

/**
 * The error for a hash the RPC has never seen. The usual cause is a Safe, which
 * (directly or over WalletConnect) hands back its off-chain `safeTxHash` rather
 * than the hash of the transaction that eventually executes it.
 */
export function missingTransactionMessage(pending: boolean): string {
  return pending
    ? 'The transaction has not been mined yet. Submit it again once it is confirmed.'
    : 'No transaction with this hash exists on this network. A Safe returns its Safe ' +
        'transaction hash (safeTxHash) before execution; once the Safe has executed the ' +
        'transaction, submit the hash of that executed on-chain transaction instead.';
}

export function redemptionManagerLogs<T extends { address: string }>(
  logs: T[],
  manager: string,
): T[] {
  return logs.filter((log) => log.address.toLowerCase() === manager.toLowerCase());
}

export function assertRedemptionEventArgs(
  actual: Record<string, unknown>,
  expected: Record<string, string | bigint | boolean>,
): void {
  for (const [label, value] of Object.entries(expected)) {
    const candidate = actual[label];
    if (typeof value === 'boolean' ? candidate !== value : !same(candidate, value)) {
      throw new Error(`Confirmed transaction ${label} does not match this workflow`);
    }
  }
}

/**
 * Whether `actor` executed this transaction: it sent it itself (an EOA), or it
 * is a Safe that emitted `ExecutionSuccess` within it.
 */
export function actorExecutedTransaction(input: {
  from: string;
  logs: readonly RawReceiptLog[];
  actor: string;
}): boolean {
  if (same(input.from, input.actor)) return true;
  return input.logs.some(
    (log) =>
      same(log.address, input.actor) &&
      typeof log.topics[0] === 'string' &&
      same(log.topics[0], SAFE_EXECUTION_SUCCESS_TOPIC),
  );
}

export type RecoveryStep =
  | { kind: 'propose'; tokenId: string; evidenceDigest: string }
  | { kind: 'approve'; tokenId: string; proposalHash: string }
  | { kind: 'execute'; tokenId: string; gemId: string; owner: string; proposalHash: string };

/**
 * Validates a recovery step by what the RedemptionManager emitted, so a direct
 * EOA call and a Safe execution are accepted alike.
 *
 * Propose and approve are bound by the contract's own `proposer`/`approver`
 * argument, which is `msg.sender` of the manager call. `executeRecovery` emits
 * no actor, so there the approver must have sent the transaction or, as a Safe,
 * executed it.
 */
export function verifyRecoveryReceipt(input: {
  chainId: number;
  expectedChainId: number;
  status: string;
  from: string;
  manager: string;
  approver: string;
  rawLogs: readonly RawReceiptLog[];
  managerLogs: readonly ParsedManagerLog[];
  step: RecoveryStep;
}): { proposalHash: string; approvals: number | null } {
  assertReceiptOutcome(input);
  const events = input.managerLogs
    .filter((log) => same(log.address, input.manager))
    .map((log) => ({
      eventName: log.eventName,
      args: (log.args ?? {}) as Record<string, unknown>,
    }));
  const { step } = input;

  const approval = (proposalHash: string) =>
    events.find(
      (event) =>
        event.eventName === 'RecoveryApproved' &&
        same(event.args.tokenId, step.tokenId) &&
        same(event.args.proposalHash, proposalHash) &&
        same(event.args.approver, input.approver),
    );

  if (step.kind === 'propose') {
    const proposed = events.find(
      (event) =>
        event.eventName === 'RecoveryProposed' &&
        same(event.args.tokenId, step.tokenId) &&
        same(event.args.evidenceDigest, step.evidenceDigest) &&
        same(event.args.proposer, input.approver),
    );
    if (!proposed) {
      throw new Error('Confirmed transaction did not propose this recovery from the acting wallet');
    }
    const proposalHash = String(proposed.args.proposalHash);
    const first = approval(proposalHash);
    if (!first) {
      throw new Error('Confirmed transaction did not record the proposer approval');
    }
    return { proposalHash, approvals: Number(first.args.approvals) };
  }

  if (step.kind === 'approve') {
    const approved = approval(step.proposalHash);
    if (!approved) {
      throw new Error('Confirmed transaction did not approve this recovery from the acting wallet');
    }
    return { proposalHash: step.proposalHash, approvals: Number(approved.args.approvals) };
  }

  const finalized = events.find(
    (event) =>
      event.eventName === 'RedemptionFinalized' &&
      same(event.args.tokenId, step.tokenId) &&
      same(event.args.gemId, step.gemId) &&
      same(event.args.owner, step.owner),
  );
  if (!finalized) throw new Error('Confirmed transaction did not emit RedemptionFinalized');
  if (finalized.args.recovered !== true) {
    throw new Error('Recovery transaction was not finalized as recovery');
  }
  if (!actorExecutedTransaction({ from: input.from, logs: input.rawLogs, actor: input.approver })) {
    throw new Error('Recovery execution was not sent or executed by the acting recovery wallet');
  }
  return { proposalHash: step.proposalHash, approvals: null };
}

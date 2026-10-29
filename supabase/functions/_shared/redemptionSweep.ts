/**
 * Which open redemption rows a `RedemptionCancelled`/`RedemptionConfirmed` log
 * actually closed.
 *
 * Neither event carries a request identifier, only `(tokenId, gemId)`, so
 * matching by token alone let a replayed cancel of an old request close a newer
 * request for the same token. A row is closed only when there is positive
 * evidence that it was the request open at that log:
 *
 *  - a row whose workflow is the manager's current, still-open record is never
 *    closed (that request is demonstrably alive on-chain);
 *  - a confirmation closes the row whose workflow the completed record names;
 *  - otherwise a row is closed only if its own recorded transaction (its open,
 *    or a later step of the same request) is ordered before the event. A row
 *    with no recorded transaction never verifiably reached the chain, and is
 *    left for its owner to discard or for the registry reconciliation.
 */

export interface ChainPosition {
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
}

export interface SweepRedemptionRow {
  id: string;
  workflowIdHash: string;
  transactionHash: string | null;
}

/** RedemptionManager.RedemptionPhase. */
const PHASE_NONE = 0;
const PHASE_COMPLETED = 5;

export function positionBefore(left: ChainPosition, right: ChainPosition): boolean {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber;
  if (left.transactionIndex !== right.transactionIndex) {
    return left.transactionIndex < right.transactionIndex;
  }
  return left.logIndex < right.logIndex;
}

export function rowsClosedByRedemptionEvent(input: {
  eventName: 'RedemptionCancelled' | 'RedemptionConfirmed';
  event: ChainPosition;
  rows: SweepRedemptionRow[];
  /** The manager's record for the token now, or null when it could not be read. */
  chainRecord: { workflowIdHash: string; phase: number } | null;
  /** Where each row's recorded transaction sits, or null when unknown. */
  rowPositions: Map<string, ChainPosition | null>;
}): string[] {
  const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
  const record = input.chainRecord;
  const stillOpen = (row: SweepRedemptionRow) =>
    Boolean(
      record &&
      record.phase !== PHASE_NONE &&
      record.phase !== PHASE_COMPLETED &&
      same(record.workflowIdHash, row.workflowIdHash),
    );

  if (input.eventName === 'RedemptionConfirmed' && record?.phase === PHASE_COMPLETED) {
    const completed = input.rows.find((row) => same(row.workflowIdHash, record.workflowIdHash));
    if (completed) return [completed.id];
  }

  return input.rows
    .filter((row) => !stillOpen(row))
    .filter((row) => {
      const position = input.rowPositions.get(row.id);
      return Boolean(position && positionBefore(position, input.event));
    })
    .map((row) => row.id);
}

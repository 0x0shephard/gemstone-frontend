/**
 * Average seconds per block, used to turn a span of time into a span of blocks.
 *
 * Block-count constants tuned on Sepolia (12 s) are 48x too short on Arbitrum
 * (0.25 s): a week of history became three and a half hours. Each figure is the
 * chain's fastest typical cadence, so the block count errs long and a window is
 * never shorter than the time it stands for.
 */
const AVERAGE_BLOCK_SECONDS: Record<number, number> = {
  1: 12,
  11155111: 12,
  42161: 0.25,
  42170: 0.25,
  421614: 0.25,
  10: 2,
  11155420: 2,
  8453: 2,
  84532: 2,
};

/** An unknown chain is assumed fast, for the same reason. */
const UNKNOWN_CHAIN_BLOCK_SECONDS = 0.25;

export function blocksForSeconds(chainId: number, seconds: number): bigint {
  const perBlock = AVERAGE_BLOCK_SECONDS[chainId] ?? UNKNOWN_CHAIN_BLOCK_SECONDS;
  return BigInt(Math.ceil(seconds / perBlock));
}

/** `blocks` back from `head`, but never before `floor` (the deployment block). */
export function blocksBack(head: bigint, blocks: bigint, floor: bigint): bigint {
  const back = head > blocks ? head - blocks : 0n;
  return back > floor ? back : floor;
}

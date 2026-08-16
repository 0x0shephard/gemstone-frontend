import type { Log } from 'npm:viem@2';
import type { Address } from 'npm:viem@2';
import { isRateLimited, narrowedSpan, planScanRanges } from './demandMath.ts';
import type { OperatorChain } from './chain.ts';

/**
 * Resumable `eth_getLogs` scanning.
 *
 * Every sweep that reads history hits the same three problems, and getting any
 * one of them wrong is silent rather than loud:
 *
 *   Providers cap the block range, and the cap varies by plan — one of ours
 *   allows ten blocks. A scanner with a fixed minimum chunk width below which it
 *   throws simply never works against a provider whose cap is lower, however
 *   many times it is retried.
 *
 *   A full history scan does not fit in one function invocation, so progress has
 *   to be durable. A scan that only records its cursor on completion makes no
 *   progress at all when it cannot complete.
 *
 *   The platform kills the isolate at a wall-clock limit. Stopping voluntarily
 *   before that, and saying so, is the difference between resuming next run and
 *   starting over.
 */

/** Under every common provider cap; only ratchets down from here. */
export const INITIAL_SPAN = 1_000n;

/** First pause after a rate limit; doubles while the limit keeps being hit. */
const INITIAL_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 4_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ScanOptions {
  /** Contract whose logs to read. */
  address: Address;
  from: bigint;
  to: bigint;
  /** Called per chunk. Throwing aborts the scan without advancing the cursor. */
  onLogs: (logs: Log[], range: { from: bigint; to: bigint }) => Promise<void> | void;
  /**
   * Called when it is safe to record progress, with the last fully scanned
   * block. Invoked periodically and once at the end.
   */
  onProgress?: (through: bigint) => Promise<void> | void;
  /** Chunks between `onProgress` calls. */
  commitEvery?: number;
  budgetMs?: number;
  now?: () => number;
}

export interface ScanResult {
  scannedThrough: bigint;
  caughtUp: boolean;
  blocksBehind: bigint;
  chunks: number;
}

/**
 * Reads logs from `from` to `to`, narrowing chunk width to whatever the provider
 * will accept and stopping cleanly when the budget runs out.
 */
export async function scanLogs(chain: OperatorChain, options: ScanOptions): Promise<ScanResult> {
  const { address, from, to, onLogs, onProgress } = options;
  const commitEvery = options.commitEvery ?? 20;
  const budgetMs = options.budgetMs ?? 45_000;
  const now = options.now ?? Date.now;
  const startedAt = now();

  if (from > to) {
    return { scannedThrough: to, caughtUp: true, blocksBehind: 0n, chunks: 0 };
  }

  let span = INITIAL_SPAN;
  let position = from;
  let chunks = 0;
  let sinceCommit = 0;
  /*
   * Pause held between chunks for the rest of the run once a rate limit is seen.
   *
   * Self-tuning rather than a fixed delay: a provider with headroom is never
   * slowed down, and one that pushes back is backed off from until it stops.
   */
  let pacingMs = 0;
  let backoffMs = INITIAL_BACKOFF_MS;

  const commit = async (through: bigint) => {
    if (onProgress) await onProgress(through);
    sinceCommit = 0;
  };

  while (position <= to) {
    if (now() - startedAt > budgetMs) break;
    if (pacingMs > 0) await sleep(pacingMs);

    const [range] = planScanRanges(position, to, span);
    try {
      const logs = (await chain.logsClient.getLogs({
        address,
        fromBlock: range.from,
        toBlock: range.to,
      })) as Log[];
      // Handled before the cursor moves, so a handler that throws leaves the
      // range unscanned rather than silently skipped.
      await onLogs(logs, range);
      position = range.to + 1n;
      chunks += 1;
      sinceCommit += 1;
      if (sinceCommit >= commitEvery) await commit(position - 1n);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      /*
       * Rate limits are not failures, they are a pace. Backing off and coming
       * back to the same range is the only response that helps — narrowing the
       * span would ask for the same blocks in more requests, which is what is
       * being limited — and giving up would fail a scheduled job over a
       * condition that resolves itself within a second.
       *
       * No retry ceiling is needed: the budget above already bounds this. A
       * provider that never lets up simply means this run makes little progress
       * and says so, rather than erroring.
       */
      if (isRateLimited(message)) {
        await sleep(backoffMs);
        pacingMs = Math.max(pacingMs, backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        continue;
      }

      const next = narrowedSpan(span, message);
      if (next === null) {
        // Out of room to narrow: this is an outage, not a range cap. Keep the
        // ground already covered rather than discarding it with the error.
        if (position > from) await commit(position - 1n);
        throw error;
      }
      span = next;
    }
  }

  const scannedThrough = position - 1n;
  await commit(scannedThrough);

  return {
    scannedThrough,
    caughtUp: position > to,
    blocksBehind: position > to ? 0n : to - scannedThrough,
    chunks,
  };
}

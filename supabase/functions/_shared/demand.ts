import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { parseEventLogs } from 'npm:viem@2';
import { operatorChain, primarySaleAbi, type OperatorChain } from './chain.ts';
import { aggregateDemand, type BidObservation } from './demandMath.ts';
import { scanLogs } from './logScan.ts';
import type { DemandInput } from './valuationMath.ts';

type AdminClient = SupabaseClient;

/**
 * Ingests `BidPlaced` events and serves the demand counts that drive market
 * preference multipliers.
 */

/** Re-read recent blocks so a reorg near the head cannot strand a bid. */
const REORG_REPLAY_BLOCKS = 64n;
/**
 * Wall clock allowed for one pass.
 *
 * A run that stops here is not a failure: the cursor is committed as it goes, so
 * the next run resumes where this one stopped. Comfortably inside the platform's
 * own limit, which kills the isolate outright and would lose the tail of the
 * scan along with it.
 */
const SCAN_BUDGET_MS = 45_000;
/**
 * Chunks scanned between cursor commits.
 *
 * Rows are keyed by `(tx_hash, log_index)` and the cursor only moves backwards
 * on a crash, so re-reading up to this many chunks is free. Committing on every
 * chunk would triple the round trips for no gain.
 */
const COMMIT_EVERY = 20;
/** Rolling aggregation window. Older bids stop influencing price. */
export const DEFAULT_WINDOW_DAYS = 90;

interface GemAttributes {
  shape: string | null;
  color: string | null;
  colorGrade: string | null;
}

/**
 * Attributes as recorded for a gem.
 *
 * Prefers lab-graded values over seller claims. The seller intake form has no
 * shape or colour-grade field — `cut` is the closest claim to a shape — so until
 * the grading portal exists colour grade is simply absent, and the engine treats
 * that criterion as neutral rather than as zero demand.
 */
function attributesFrom(row: {
  attributes: Record<string, unknown> | null;
  graded_attributes: Record<string, unknown> | null;
}): GemAttributes {
  const graded = row.graded_attributes ?? {};
  const claimed = row.attributes ?? {};
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = graded[key] ?? claimed[key];
      if (typeof value === 'string' && value.trim() !== '') return value;
    }
    return null;
  };
  return {
    shape: pick('shape', 'cut'),
    color: pick('color'),
    colorGrade: pick('colorGrade'),
  };
}

async function scannedThroughBlock(admin: AdminClient, chain: OperatorChain): Promise<bigint> {
  const { data, error } = await admin
    .from('demand_scan_state')
    .select('scanned_through_block')
    .maybeSingle();
  if (error) throw error;
  return data ? BigInt(data.scanned_through_block) : chain.deploymentBlock;
}

/**
 * Reads `BidPlaced` logs since the last scan and records them.
 *
 * Safe to run repeatedly and to overlap ranges: rows are keyed by
 * `(tx_hash, log_index)`, so a replayed log is ignored rather than double
 * counted. The cursor only advances after the rows are written.
 */
export async function ingestBidEvents(
  admin: AdminClient,
  chain: OperatorChain = operatorChain(),
  options: { budgetMs?: number; now?: () => number } = {},
): Promise<{ scannedThrough: bigint; inserted: number; caughtUp: boolean; blocksBehind: bigint }> {
  const head = await chain.publicClient.getBlockNumber();
  const cursor = await scannedThroughBlock(admin, chain);
  const from =
    cursor > chain.deploymentBlock + REORG_REPLAY_BLOCKS
      ? cursor - REORG_REPLAY_BLOCKS
      : chain.deploymentBlock;

  type BidLog = {
    gemId: bigint;
    bidder: string;
    blockNumber: bigint;
    txHash: string;
    logIndex: number;
  };

  let inserted = 0;
  let pending: BidLog[] = [];

  const result = await scanLogs(chain, {
    address: chain.addresses.primarySale,
    from,
    to: head,
    budgetMs: options.budgetMs ?? SCAN_BUDGET_MS,
    now: options.now,
    commitEvery: COMMIT_EVERY,
    onLogs: (logs) => {
      for (const event of parseEventLogs({
        abi: primarySaleAbi,
        logs: logs as never,
        eventName: 'BidPlaced',
      })) {
        if (event.blockNumber === null || event.transactionHash === null || event.logIndex === null)
          continue;
        pending.push({
          gemId: event.args.gemId as bigint,
          bidder: event.args.bidder as string,
          blockNumber: event.blockNumber,
          txHash: event.transactionHash,
          logIndex: event.logIndex,
        });
      }
    },
    /*
     * Bids first, cursor second. A crash between the two replays a range that is
     * already recorded, which the `(tx_hash, log_index)` key absorbs — the
     * reverse would advance past bids that were never written, losing them.
     */
    onProgress: async (through) => {
      if (pending.length > 0) {
        inserted += await writeBids(admin, chain, pending);
        pending = [];
      }
      const { error } = await admin.from('demand_scan_state').upsert({
        id: true,
        scanned_through_block: Number(through),
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
  });

  return {
    scannedThrough: result.scannedThrough,
    inserted,
    caughtUp: result.caughtUp,
    blocksBehind: result.blocksBehind,
  };
}

/** Resolves attributes and block times for a batch of bids, then records them. */
async function writeBids(
  admin: AdminClient,
  chain: OperatorChain,
  logs: readonly {
    gemId: bigint;
    bidder: string;
    blockNumber: bigint;
    txHash: string;
    logIndex: number;
  }[],
): Promise<number> {
  const gemIds = [...new Set(logs.map((log) => log.gemId.toString()))];
  const { data: submissions, error: submissionError } = await admin
    .from('seller_submissions')
    .select('onchain_gem_id,attributes,graded_attributes')
    .in('onchain_gem_id', gemIds);
  if (submissionError) throw submissionError;
  const attributesByGem = new Map(
    (submissions ?? []).map((row) => [String(row.onchain_gem_id), attributesFrom(row)]),
  );

  // One request per distinct block rather than per log.
  const blockNumbers = [...new Set(logs.map((log) => log.blockNumber))];
  const timestamps = new Map<bigint, string>();
  for (const blockNumber of blockNumbers) {
    const block = await chain.publicClient.getBlock({ blockNumber });
    timestamps.set(blockNumber, new Date(Number(block.timestamp) * 1_000).toISOString());
  }

  const rows = logs.map((log) => {
    const attributes = attributesByGem.get(log.gemId.toString());
    return {
      gem_id: log.gemId.toString(),
      bidder: log.bidder.toLowerCase(),
      tx_hash: log.txHash,
      log_index: log.logIndex,
      block_number: Number(log.blockNumber),
      observed_at: timestamps.get(log.blockNumber),
      shape: attributes?.shape ?? null,
      color: attributes?.color ?? null,
      color_grade: attributes?.colorGrade ?? null,
    };
  });

  const { data: written, error: insertError } = await admin
    .from('demand_bids')
    .upsert(rows, { onConflict: 'tx_hash,log_index', ignoreDuplicates: true })
    .select('id');
  if (insertError) throw insertError;
  return written?.length ?? 0;
}

/**
 * Demand counts for pricing, over a rolling window.
 *
 * The caller must pass the returned snapshot into the valuation so it is captured
 * in the commitment. Reading it again later would give a different answer once
 * more bids land, and `valuationHash` promises the decision is reproducible.
 */
export async function currentDemand(
  admin: AdminClient,
  options: { windowDays?: number } = {},
): Promise<DemandInput> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1_000);

  const { data, error } = await admin
    .from('demand_bids')
    .select('gem_id,bidder,observed_at,shape,color,color_grade')
    .gte('observed_at', since.toISOString());
  if (error) throw error;

  const observations: BidObservation[] = (data ?? []).map((row) => ({
    gemId: String(row.gem_id),
    bidder: String(row.bidder),
    observedAt: String(row.observed_at),
    shape: row.shape,
    color: row.color,
    colorGrade: row.color_grade,
  }));
  return aggregateDemand(observations, { since });
}

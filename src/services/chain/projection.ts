import { decodeEventLog, type Abi, type Address, type Hash, type PublicClient } from 'viem';
import {
  contractAddresses,
  contractModules,
  deploymentManifestHash,
  requireDeploymentManifest,
  type ContractModule,
} from '@/config/contracts';
import { contracts } from '@/contracts';

const DATABASE_VERSION = 1;
const RECENT_RESCAN_BLOCKS = 64n;
/**
 * The first window tried. Public endpoints commonly accept 50,000 blocks; the
 * scan widens from here while the provider keeps accepting.
 */
export const INITIAL_RANGE = 50_000n;
/**
 * The widest window ever requested. Alchemy's Arbitrum One endpoint has
 * accepted 9M-block spans for these low-volume contracts; capping at the
 * initial 50,000 made a month-old deployment cost ~2,000 `eth_getLogs` calls on
 * Arbitrum's quarter-second blocks.
 */
export const MAX_RANGE = 16_000_000n;
const MIN_RANGE = 64n;
const ADDRESS_BATCH_SIZE = 4;
/** Consecutive transient failures tolerated before a scan gives up. */
const MAX_TRANSIENT_FAILURES = 10;
const BACKOFF_BASE_MS = 300;
const BACKOFF_MAX_MS = 5_000;

/**
 * Blocks behind the head treated as final when the RPC cannot report its own
 * `finalized` block, per chain. Twelve was an Ethereum-era rule of thumb; on
 * Arbitrum's 0.25 s blocks it labelled events "finalized" three seconds after
 * inclusion, long before the batch carrying them is final on L1.
 */
const FALLBACK_CONFIRMATIONS: Readonly<Record<number, bigint>> = {
  1: 64n, // Ethereum: two epochs.
  11155111: 64n, // Sepolia.
  42161: 4_800n, // Arbitrum One: ~20 minutes at 0.25 s, roughly L1 finality of its batch.
  421614: 4_800n, // Arbitrum Sepolia.
  10: 600n, // OP Mainnet: ~20 minutes at 2 s.
  11155420: 600n,
  8453: 600n, // Base.
  84532: 600n,
};

export function fallbackConfirmations(chainId: number): bigint {
  return FALLBACK_CONFIRMATIONS[chainId] ?? 64n;
}

/**
 * The newest block the chain itself reports as final (`eth_getBlockByNumber`
 * with the `finalized` tag, which Arbitrum and other L2s answer with the L2
 * block whose batch is final on L1), or a per-chain confirmation count behind
 * the head when the RPC does not support the tag.
 */
export async function finalizedBlock(
  client: Pick<PublicClient, 'getBlock'>,
  latestBlock: bigint,
  chainId: number,
): Promise<bigint> {
  try {
    const block = await client.getBlock({ blockTag: 'finalized' });
    if (typeof block?.number === 'bigint' && block.number <= latestBlock) return block.number;
  } catch {
    // Unsupported tag or transient failure: fall through to the conservative count.
  }
  const confirmations = fallbackConfirmations(chainId);
  return latestBlock > confirmations ? latestBlock - confirmations : 0n;
}

export interface ProjectedEvent {
  id: string;
  module: ContractModule;
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hash;
  logIndex: number;
  finalized: boolean;
}

export interface ProjectionStatus {
  latestBlock: bigint;
  scannedThrough: bigint;
  finalizedThrough: bigint;
  cached: boolean;
  partiallySynced: boolean;
}

export interface ProjectionSnapshot {
  events: ProjectedEvent[];
  status: ProjectionStatus;
}

export interface PersistedMeta {
  key: 'meta';
  scannedThrough: string;
  latestBlock: string;
}

/** Durable store for the projection. IndexedDB in the browser; injectable for tests. */
export interface ProjectionCache {
  read(): Promise<{ events: ProjectedEvent[]; meta?: PersistedMeta }>;
  replaceRange(fromBlock: bigint, events: ProjectedEvent[], meta: PersistedMeta): Promise<void>;
  reset(): Promise<void>;
}

interface SyncOptions {
  signal?: AbortSignal;
  cache?: ProjectionCache;
  onProgress?: (scannedThrough: bigint, latestBlock: bigint) => void;
  logClients?: PublicClient[];
  onChunk?: (
    fromBlock: bigint,
    scannedThrough: bigint,
    events: ProjectedEvent[],
  ) => void | Promise<void>;
}

function announce(detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent('dc:chain-sync', { detail }));
}

const encode = (value: unknown): unknown => {
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)]));
  }
  return value;
};

const decode = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.$bigint === 'string') return BigInt(record.$bigint);
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, decode(child)]));
  }
  return value;
};

function databaseName(): string {
  const manifest = requireDeploymentManifest();
  return `digital-carat:${manifest.chainId}:${deploymentManifestHash}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName(), DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('events')) {
        const store = db.createObjectStore('events', { keyPath: 'id' });
        store.createIndex('blockNumber', 'blockSort');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('Chain projection database is blocked by another tab'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

async function readCache(): Promise<{ events: ProjectedEvent[]; meta?: PersistedMeta }> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(['events', 'meta'], 'readonly');
    const eventsRequest = transaction.objectStore('events').getAll();
    const metaRequest = transaction.objectStore('meta').get('meta');
    const [persistedEvents, meta] = await Promise.all([
      requestResult(eventsRequest),
      requestResult(metaRequest) as Promise<PersistedMeta | undefined>,
    ]);
    await transactionDone(transaction);
    return {
      events: (persistedEvents as Array<Record<string, unknown>>).map((event) => {
        const decoded = decode(event) as ProjectedEvent & { blockSort?: string };
        decoded.blockNumber = BigInt(String(event.blockNumber));
        delete decoded.blockSort;
        return decoded;
      }),
      meta,
    };
  } finally {
    db.close();
  }
}

async function replaceRange(
  fromBlock: bigint,
  events: ProjectedEvent[],
  meta: PersistedMeta,
): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(['events', 'meta'], 'readwrite');
    const store = transaction.objectStore('events');
    const completion = transactionDone(transaction);
    await new Promise<void>((resolve, reject) => {
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        for (const event of request.result as Array<Record<string, unknown>>) {
          if (BigInt(String(event.blockNumber ?? 0)) >= fromBlock) store.delete(String(event.id));
        }
        for (const event of events) {
          store.put({
            ...(encode(event) as Record<string, unknown>),
            id: event.id,
            blockNumber: event.blockNumber.toString(),
            blockSort: event.blockNumber.toString().padStart(32, '0'),
          });
        }
        transaction.objectStore('meta').put(meta);
        resolve();
      };
    });
    await completion;
  } finally {
    db.close();
  }
}

async function recoverCorruptedCache(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(databaseName());
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

let addressToModule: Map<string, ContractModule> | undefined;

/** Resolved lazily so importing this module never requires a configured deployment. */
function moduleForAddress(address: Address): ContractModule | undefined {
  addressToModule ??= new Map(
    contractModules
      .map((moduleName) => [contractAddresses[moduleName]?.toLowerCase(), moduleName] as const)
      .filter((entry): entry is [string, ContractModule] => Boolean(entry[0])),
  );
  return addressToModule.get(address.toLowerCase());
}

function decodeLog(
  log: {
    address: Address;
    data: Hash;
    topics: readonly Hash[];
    blockNumber: bigint | null;
    transactionHash: Hash | null;
    logIndex: number | null;
  },
  finalizedThrough: bigint,
): ProjectedEvent | undefined {
  const moduleName = moduleForAddress(log.address);
  if (!moduleName || log.blockNumber === null || !log.transactionHash || log.logIndex === null)
    return;
  try {
    const decodedLog = decodeEventLog({
      abi: contracts[moduleName].abi as Abi,
      data: log.data,
      topics: log.topics as [Hash, ...Hash[]],
      strict: false,
    });
    return {
      id: `${log.blockNumber}:${log.logIndex}:${log.transactionHash}`,
      module: moduleName,
      eventName: String(decodedLog.eventName),
      args: (decodedLog.args ?? {}) as Record<string, unknown>,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      finalized: log.blockNumber <= finalizedThrough,
    };
  } catch {
    return;
  }
}

const SUFFIX: Record<string, bigint> = { '': 1n, k: 1_000n, m: 1_000_000n };

/**
 * Whether a failure says the request was too big, as opposed to the provider
 * being briefly unavailable. Only a size rejection lowers the scan's ceiling;
 * a 429 or a timeout says nothing about what span the provider accepts.
 */
export function isRangeRejection(error: unknown): boolean {
  if (providerRangeHint(error) !== undefined) return true;
  const errors = error instanceof AggregateError ? error.errors : [error];
  return errors.some((candidate) => {
    const message = candidate instanceof Error ? candidate.message : String(candidate);
    return /block range|response size|range (?:is )?too (?:large|wide)|too many (?:blocks|results|logs)|more than \d+ (?:results|logs)|query returned more than|exceed(?:s|ed)? (?:the )?(?:max|limit)/i.test(
      message,
    );
  });
}

/**
 * The widest `eth_getLogs` span a provider's rejection says it will accept, if it
 * says. Formats seen:
 * - PublicNode: "Maximum allowed number of requested blocks is 50000"
 * - "maximum block range: 2000"
 * - Alchemy: "…requests with up to a 2K block range…", plus
 *   "this block range should work: [0x1a2b, 0x1d2c]"
 * The K/M suffix matters: read as a bare number, Alchemy's "2K" is a 2-block span.
 */
export function providerRangeHint(error: unknown): bigint | undefined {
  const errors = error instanceof AggregateError ? error.errors : [error];
  const suggestions = errors.flatMap((candidate) => {
    const message = candidate instanceof Error ? candidate.message : String(candidate);
    const stated = [
      ...message.matchAll(
        /(?:up to a|maximum(?: allowed)?(?: number of requested blocks is| block range:))\s*(\d+)\s*([km]?)\b/gi,
      ),
    ].map((match) => BigInt(match[1]) * SUFFIX[match[2].toLowerCase()]);
    const workable = [
      ...message.matchAll(
        /block range should work:\s*\[\s*(0x[0-9a-f]+)\s*,\s*(0x[0-9a-f]+)\s*\]/gi,
      ),
    ].map((match) => BigInt(match[2]) - BigInt(match[1]) + 1n);
    return [...stated, ...workable].filter((value) => value > 0n);
  });
  return suggestions.length
    ? suggestions.reduce((largest, value) => (value > largest ? value : largest))
    : undefined;
}

export async function scanLogs(
  client: PublicClient,
  fromBlock: bigint,
  latestBlock: bigint,
  finalizedThrough: bigint,
  options: SyncOptions,
): Promise<ProjectedEvent[]> {
  const events: ProjectedEvent[] = [];
  let cursor = fromBlock;
  let range = INITIAL_RANGE;
  /**
   * Widest span the provider may still accept. It starts at {@link MAX_RANGE}
   * so a permissive provider is used at full width, and drops only when the
   * provider rejects a span as too large. A rejected span is then never
   * retried within the scan: growing back into a known-rejected width made
   * every successful chunk cost a second, failing request plus a backoff sleep.
   */
  let ceiling = MAX_RANGE;
  /**
   * Transient failures (rate limits, timeouts, dropped connections) narrow the
   * next request without touching the ceiling, so the window grows back once
   * the provider recovers. They used to halve the ceiling for good: one burst
   * of 429s left the rest of the scan crawling at a fraction of the width.
   */
  let transientFailures = 0;
  const addresses = contractModules.map((moduleName) => contractAddresses[moduleName]!);

  const requestLogs = async (address: Address, from: bigint, to: bigint) => {
    const candidates = [...(options.logClients ?? []), client].filter(
      (candidate, index, all) => all.indexOf(candidate) === index,
    );
    const errors: unknown[] = [];
    for (const candidate of candidates) {
      try {
        return await candidate.getLogs({ address, fromBlock: from, toBlock: to });
      } catch (error) {
        errors.push(error);
      }
    }
    const last = errors.at(-1);
    const detail = last instanceof Error ? `: ${last.message}` : '';
    throw new AggregateError(errors, `Every historical log provider rejected the request${detail}`);
  };

  while (cursor <= latestBlock) {
    if (options.signal?.aborted) throw new DOMException('Projection sync cancelled', 'AbortError');
    const chunkFrom = cursor;
    const toBlock = cursor + range - 1n > latestBlock ? latestBlock : cursor + range - 1n;
    try {
      /*
       * PublicNode rejects an array of ten addresses even though it accepts the
       * same range for each address independently. Query small batches in
       * parallel: six ranges × three batches is fast enough for a fresh phone,
       * without a ten-request burst that risks rate limiting.
       */
      const logs = [];
      for (let index = 0; index < addresses.length; index += ADDRESS_BATCH_SIZE) {
        const batch = addresses.slice(index, index + ADDRESS_BATCH_SIZE);
        const results = await Promise.all(
          batch.map((address) => requestLogs(address, cursor, toBlock)),
        );
        logs.push(...results.flat());
      }
      const chunkEvents: ProjectedEvent[] = [];
      for (const log of logs) {
        const projected = decodeLog(log, finalizedThrough);
        if (projected) {
          events.push(projected);
          chunkEvents.push(projected);
        }
      }
      // Replays checkpoint only complete address/range batches. A phone
      // suspended halfway through a long replay can resume from here instead
      // of discarding every successful request made so far.
      await options.onChunk?.(chunkFrom, toBlock, chunkEvents);
      cursor = toBlock + 1n;
      transientFailures = 0;
      options.onProgress?.(toBlock, latestBlock);
      if (logs.length < 1_000 && range < ceiling) {
        range = range * 2n > ceiling ? ceiling : range * 2n;
      }
    } catch (error) {
      if (isRangeRejection(error)) {
        if (range <= MIN_RANGE) throw error;
        const providerRange = providerRangeHint(error);
        const narrower = providerRange && providerRange < range ? providerRange : range / 2n;
        ceiling = narrower < MIN_RANGE ? MIN_RANGE : narrower;
        range = ceiling;
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_BASE_MS));
        continue;
      }
      transientFailures += 1;
      if (transientFailures > MAX_TRANSIENT_FAILURES) throw error;
      // A timeout may still be the span's fault, so the retry is narrower;
      // the ceiling is left alone for the window to grow back into.
      const halved = range / 2n;
      range = halved < MIN_RANGE ? MIN_RANGE : halved;
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (transientFailures - 1));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return events;
}

const indexedDbCache: ProjectionCache = {
  read: readCache,
  replaceRange,
  reset: recoverCorruptedCache,
};

export async function syncProjection(
  client: PublicClient,
  options: SyncOptions = {},
): Promise<ProjectionSnapshot> {
  const manifest = requireDeploymentManifest();
  const cache = options.cache ?? indexedDbCache;
  let cached: Awaited<ReturnType<ProjectionCache['read']>>;
  try {
    cached = await cache.read();
  } catch {
    await cache.reset();
    cached = { events: [] };
  }

  try {
    const latestBlock = await client.getBlockNumber();
    announce({ state: 'syncing', latestBlock: latestBlock.toString() });
    const finalizedThrough = await finalizedBlock(client, latestBlock, manifest.chainId);
    const prior = cached.meta ? BigInt(cached.meta.scannedThrough) : manifest.deploymentBlock;
    const fromBlock =
      prior > RECENT_RESCAN_BLOCKS + manifest.deploymentBlock
        ? prior - RECENT_RESCAN_BLOCKS
        : manifest.deploymentBlock;
    const rescanned = await scanLogs(client, fromBlock, latestBlock, finalizedThrough, {
      ...options,
      /*
       * Every sync checkpoints, not only a cold one. A warm sync after a week
       * away is itself a long replay, and without checkpoints a failure part
       * way through threw all of it away and started again from the old mark.
       * Each chunk replaces everything from its first block, so the cache stays
       * a contiguous, correct prefix ending at `scannedThrough`.
       */
      onChunk: async (chunkFrom, scannedThrough, chunkEvents) => {
        await cache.replaceRange(chunkFrom, chunkEvents, {
          key: 'meta',
          scannedThrough: scannedThrough.toString(),
          latestBlock: latestBlock.toString(),
        });
        await options.onChunk?.(chunkFrom, scannedThrough, chunkEvents);
      },
      onProgress: (scannedThrough, latest) => {
        options.onProgress?.(scannedThrough, latest);
        announce({
          state: 'syncing',
          scannedThrough: scannedThrough.toString(),
          latestBlock: latest.toString(),
        });
      },
    });
    await cache.replaceRange(fromBlock, rescanned, {
      key: 'meta',
      scannedThrough: latestBlock.toString(),
      latestBlock: latestBlock.toString(),
    });
    const fresh = await cache.read();
    announce({ state: 'synced', latestBlock: latestBlock.toString(), cached: false });
    return {
      events: fresh.events.sort(
        (left, right) =>
          Number(left.blockNumber - right.blockNumber) || left.logIndex - right.logIndex,
      ),
      status: {
        latestBlock,
        scannedThrough: latestBlock,
        finalizedThrough,
        cached: false,
        partiallySynced: false,
      },
    };
  } catch (error) {
    // A cold replay may have published durable chunks before a later provider
    // request failed. Re-read those checkpoints and expose an explicit partial
    // snapshot instead of throwing away progress or presenting fake emptiness.
    const durable = await cache.read().catch(() => cached);
    if (durable.events.length === 0 && !durable.meta) {
      announce({ state: 'error' });
      throw error;
    }
    const scannedThrough = BigInt(durable.meta?.scannedThrough ?? manifest.deploymentBlock);
    announce({ state: 'stale', latestBlock: scannedThrough.toString(), cached: true });
    return {
      events: durable.events.sort(
        (left, right) =>
          Number(left.blockNumber - right.blockNumber) || left.logIndex - right.logIndex,
      ),
      status: {
        latestBlock: BigInt(durable.meta?.latestBlock ?? scannedThrough),
        scannedThrough,
        finalizedThrough:
          scannedThrough > fallbackConfirmations(manifest.chainId)
            ? scannedThrough - fallbackConfirmations(manifest.chainId)
            : 0n,
        cached: true,
        partiallySynced: true,
      },
    };
  }
}

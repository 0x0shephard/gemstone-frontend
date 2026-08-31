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
const FINALITY_CONFIRMATIONS = 12n;
const RECENT_RESCAN_BLOCKS = 64n;
/**
 * The dedicated historical-log endpoint accepts 50,000-block windows. That
 * keeps a fresh browser sync bounded to six windows instead of hundreds.
 */
const INITIAL_RANGE = 50_000n;
const MIN_RANGE = 64n;
const ADDRESS_BATCH_SIZE = 4;

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

interface PersistedMeta {
  key: 'meta';
  scannedThrough: string;
  latestBlock: string;
}

interface SyncOptions {
  signal?: AbortSignal;
  onProgress?: (scannedThrough: bigint, latestBlock: bigint) => void;
  logClients?: PublicClient[];
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
   * Largest span this provider has accepted so far. A rejected span is never
   * retried within a scan: growing back into a known-rejected width made every
   * successful chunk cost a second, failing request plus a backoff sleep.
   */
  let ceiling = INITIAL_RANGE;
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

  const suggestedRange = (error: unknown): bigint | undefined => {
    const errors = error instanceof AggregateError ? error.errors : [error];
    const suggestions = errors.flatMap((candidate) => {
      const message = candidate instanceof Error ? candidate.message : String(candidate);
      return [
        ...message.matchAll(
          /(?:up to a|maximum(?: allowed)?(?: number of requested blocks is| block range:))\s*(\d+)/gi,
        ),
      ].map((match) => BigInt(match[1]));
    });
    return suggestions.length
      ? suggestions.reduce((largest, value) => (value > largest ? value : largest))
      : undefined;
  };

  while (cursor <= latestBlock) {
    if (options.signal?.aborted) throw new DOMException('Projection sync cancelled', 'AbortError');
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
      for (const log of logs) {
        const projected = decodeLog(log, finalizedThrough);
        if (projected) events.push(projected);
      }
      cursor = toBlock + 1n;
      options.onProgress?.(toBlock, latestBlock);
      if (logs.length < 1_000 && range < ceiling) range *= 2n;
    } catch (error) {
      if (range <= MIN_RANGE) throw error;
      const providerRange = suggestedRange(error);
      const narrower = providerRange && providerRange < range ? providerRange : range / 2n;
      ceiling = narrower < MIN_RANGE ? MIN_RANGE : narrower;
      range = ceiling;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return events;
}

export async function syncProjection(
  client: PublicClient,
  options: SyncOptions = {},
): Promise<ProjectionSnapshot> {
  const manifest = requireDeploymentManifest();
  let cached: Awaited<ReturnType<typeof readCache>>;
  try {
    cached = await readCache();
  } catch {
    await recoverCorruptedCache();
    cached = { events: [] };
  }

  try {
    const latestBlock = await client.getBlockNumber();
    announce({ state: 'syncing', latestBlock: latestBlock.toString() });
    const finalizedThrough =
      latestBlock > FINALITY_CONFIRMATIONS ? latestBlock - FINALITY_CONFIRMATIONS : 0n;
    const prior = cached.meta ? BigInt(cached.meta.scannedThrough) : manifest.deploymentBlock;
    const fromBlock =
      prior > RECENT_RESCAN_BLOCKS + manifest.deploymentBlock
        ? prior - RECENT_RESCAN_BLOCKS
        : manifest.deploymentBlock;
    const rescanned = await scanLogs(client, fromBlock, latestBlock, finalizedThrough, {
      ...options,
      onProgress: (scannedThrough, latest) => {
        options.onProgress?.(scannedThrough, latest);
        announce({
          state: 'syncing',
          scannedThrough: scannedThrough.toString(),
          latestBlock: latest.toString(),
        });
      },
    });
    await replaceRange(fromBlock, rescanned, {
      key: 'meta',
      scannedThrough: latestBlock.toString(),
      latestBlock: latestBlock.toString(),
    });
    const fresh = await readCache();
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
    if (cached.events.length === 0) {
      announce({ state: 'error' });
      throw error;
    }
    const scannedThrough = BigInt(cached.meta?.scannedThrough ?? manifest.deploymentBlock);
    announce({ state: 'stale', latestBlock: scannedThrough.toString(), cached: true });
    return {
      events: cached.events,
      status: {
        latestBlock: BigInt(cached.meta?.latestBlock ?? scannedThrough),
        scannedThrough,
        finalizedThrough:
          scannedThrough > FINALITY_CONFIRMATIONS ? scannedThrough - FINALITY_CONFIRMATIONS : 0n,
        cached: true,
        partiallySynced: true,
      },
    };
  }
}

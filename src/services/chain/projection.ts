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
const INITIAL_RANGE = 5_000n;
const MIN_RANGE = 64n;

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

const addressToModule = new Map(
  contractModules.map((moduleName) => [contractAddresses[moduleName]!.toLowerCase(), moduleName]),
);

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
  const moduleName = addressToModule.get(log.address.toLowerCase());
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

async function scanLogs(
  client: PublicClient,
  fromBlock: bigint,
  latestBlock: bigint,
  finalizedThrough: bigint,
  options: SyncOptions,
): Promise<ProjectedEvent[]> {
  const events: ProjectedEvent[] = [];
  let cursor = fromBlock;
  let range = INITIAL_RANGE;
  const addresses = contractModules.map((moduleName) => contractAddresses[moduleName]!);

  while (cursor <= latestBlock) {
    if (options.signal?.aborted) throw new DOMException('Projection sync cancelled', 'AbortError');
    const toBlock = cursor + range - 1n > latestBlock ? latestBlock : cursor + range - 1n;
    try {
      const logs = await client.getLogs({ address: addresses, fromBlock: cursor, toBlock });
      for (const log of logs) {
        const projected = decodeLog(log, finalizedThrough);
        if (projected) events.push(projected);
      }
      cursor = toBlock + 1n;
      options.onProgress?.(toBlock, latestBlock);
      if (logs.length < 1_000 && range < INITIAL_RANGE) range *= 2n;
    } catch (error) {
      if (range <= MIN_RANGE) throw error;
      range = range / 2n < MIN_RANGE ? MIN_RANGE : range / 2n;
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
    if (cached.events.length === 0) throw error;
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

export function discoveredIds(
  snapshot: ProjectionSnapshot,
  eventName: string,
  arg: string,
): bigint[] {
  const values = snapshot.events
    .filter((event) => event.eventName === eventName)
    .map((event) => event.args[arg])
    .filter((value): value is bigint => typeof value === 'bigint');
  return [...new Set(values.map(String))].map(BigInt);
}

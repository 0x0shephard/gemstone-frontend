import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { defaultShouldDehydrateQuery, type Query } from '@tanstack/react-query';
import type {
  PersistedClient,
  PersistQueryClientOptions,
} from '@tanstack/react-query-persist-client';
import { env } from '@/config/env';

/**
 * The last chain state this browser saw, kept across visits so a returning
 * visitor sees stones at once while fresh reads run behind them.
 *
 * This is for display only. Restored queries are already stale, so React Query
 * refetches them as they mount, and no transaction reads this cache: `preflight`
 * and each write's simulation go to the chain.
 */
const STORAGE_KEY = 'dc:query-cache:v1';

/** Longer than this and the page is better off loading than showing old stones. */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Catalogue and portfolio views only. Left out on purpose, so they always load
 * fresh: credits and refunds (money a person acts on), redemptions, pause state
 * (`bidPolicy`) and live prices (`paymentAssets`). Anything off-chain, such as
 * workflows, KYC or operations, is private and never written to storage.
 */
const PERSISTED_ROOTS = new Set([
  'gems',
  'gem',
  'listings',
  'auctions',
  'auction',
  'offers',
  'swaps',
  'profile',
  'landing',
  'feeTiers',
]);

export function shouldPersistQuery(query: Query): boolean {
  return defaultShouldDehydrateQuery(query) && PERSISTED_ROOTS.has(String(query.queryKey[0]));
}

const BIGINT_TAG = '__dc_bigint';

export function serializeClient(client: PersistedClient): string {
  return JSON.stringify(client, (_key, value: unknown) =>
    typeof value === 'bigint' ? { [BIGINT_TAG]: value.toString() } : value,
  );
}

/**
 * `secondsLeft` is worked out once, when the chain is read, and the UI uses it to
 * decide whether an auction is still open. Restored as stored, an auction that
 * ended yesterday would look live, so each one is moved on by the time since its
 * query last read the chain.
 */
export function advanceCountdowns(value: unknown, elapsedSeconds: number): unknown {
  if (Array.isArray(value)) return value.map((item) => advanceCountdowns(item, elapsedSeconds));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === 'secondsLeft' && typeof entry === 'number'
        ? Math.max(0, entry - elapsedSeconds)
        : advanceCountdowns(entry, elapsedSeconds),
    ]),
  );
}

export function deserializeClient(cached: string, now = Date.now()): PersistedClient {
  const client = JSON.parse(cached, (_key, value: unknown) =>
    value !== null && typeof value === 'object' && BIGINT_TAG in value
      ? BigInt((value as Record<typeof BIGINT_TAG, string>)[BIGINT_TAG])
      : value,
  ) as PersistedClient;
  for (const query of client.clientState.queries) {
    const elapsed = Math.max(0, Math.floor((now - query.state.dataUpdatedAt) / 1000));
    query.state.data = advanceCountdowns(query.state.data, elapsed);
  }
  return client;
}

/** Storage can be blocked outright, and reading the property then throws. */
function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Keyed to the deployment and the build, because a query's shape is whatever this
 * build's code expects: a cache from another build is discarded, not interpreted.
 */
export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: createSyncStoragePersister({
    storage: env.dataMode === 'chain' ? browserStorage() : undefined,
    key: STORAGE_KEY,
    serialize: serializeClient,
    deserialize: deserializeClient,
    throttleTime: 2_000,
  }),
  maxAge: PERSIST_MAX_AGE_MS,
  buster: `${env.deploymentRelease}:${__BUILD_COMMIT__}`,
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
};

/** For sign-out: the throttled write could otherwise outlive the session. */
export function clearPersistedQueries(): void {
  try {
    browserStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing was kept.
  }
}

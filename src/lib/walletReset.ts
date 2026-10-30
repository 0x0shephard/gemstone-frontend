/**
 * Forgets the browser's wallet connection, even when the wallet has already
 * forgotten it.
 *
 * On a phone, MetaMask Connect keeps its session in this browser (an IndexedDB
 * store called `mmconnect`, plus wagmi's and WalletConnect's keys). When the
 * MetaMask app drops its side, for an update, a cache clear or a network move,
 * the page still restores the old session. Every request then opens MetaMask
 * on "Connection Not Found", and nothing in the page could get past it.
 *
 * The connector's own `disconnect` is tried first, but it talks to the same dead
 * session, so it is bounded and its failure ignored. The local state is cleared
 * either way, and the Supabase sign-in (`sb-*`) and app preferences are kept.
 */

/** localStorage keys that belong to a wallet session, never to the account. */
const WALLET_STORAGE_KEY =
  /^(wagmi|wc@2|walletconnect|wcm|@w3m|w3m|mmconnect|metamask|mmsdk|-walletlink|rk-)/i;

/** IndexedDB stores that hold a wallet session. Projection caches are kept. */
const WALLET_DATABASE = /^(mmconnect|metamask|walletconnect|wc@2|wagmi)/i;

const DISCONNECT_TIMEOUT_MS = 3_000;

export function isWalletStorageKey(key: string): boolean {
  return WALLET_STORAGE_KEY.test(key);
}

export function isWalletDatabase(name: string): boolean {
  return WALLET_DATABASE.test(name);
}

function clearStorage(storage: Storage | undefined) {
  if (!storage) return;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isWalletStorageKey(key)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

function deleteDatabase(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    // Another tab holding it open blocks the delete; it completes when that tab
    // closes, so the reset need not wait for it.
    request.onblocked = () => resolve();
  });
}

async function clearDatabases(factory: IDBFactory | undefined) {
  if (!factory) return;
  // `databases()` is missing on older Safari; fall back to the known store.
  const names =
    typeof factory.databases === 'function'
      ? (await factory.databases().catch(() => [])).flatMap((db) => (db.name ? [db.name] : []))
      : ['mmconnect'];
  await Promise.all(names.filter(isWalletDatabase).map((name) => deleteDatabase(factory, name)));
}

export async function resetWalletSession(
  disconnect: () => Promise<unknown>,
  environment: {
    localStorage?: Storage;
    sessionStorage?: Storage;
    indexedDB?: IDBFactory;
  } = globalThis,
): Promise<void> {
  await Promise.race([
    disconnect().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, DISCONNECT_TIMEOUT_MS)),
  ]);
  try {
    clearStorage(environment.localStorage);
    clearStorage(environment.sessionStorage);
  } catch {
    // Storage can throw in a private window; the reload below still helps.
  }
  try {
    await clearDatabases(environment.indexedDB);
  } catch {
    // As above.
  }
}

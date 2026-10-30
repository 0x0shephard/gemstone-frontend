import { describe, expect, it, vi } from 'vitest';
import { isWalletDatabase, isWalletStorageKey, resetWalletSession } from './walletReset';

function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
}

function fakeIndexedDB(names: string[]) {
  const deleted: string[] = [];
  const factory = {
    databases: async () => names.map((name) => ({ name, version: 1 })),
    deleteDatabase: (name: string) => {
      deleted.push(name);
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => request.onsuccess?.({} as Event));
      return request;
    },
  } as unknown as IDBFactory;
  return { factory, deleted };
}

describe('wallet session reset', () => {
  it('recognises wallet keys and keeps the sign-in and preferences', () => {
    for (const key of [
      'wagmi.store',
      'wagmi.recentConnectorId',
      'wc@2:core:0.3//keychain',
      'mmconnect.session',
      'rk-recent',
    ]) {
      expect(isWalletStorageKey(key), key).toBe(true);
    }
    for (const key of ['sb-ozqesbzewekolpeaxaux-auth-token', 'dc-color-scheme', 'dc-diagnostics']) {
      expect(isWalletStorageKey(key), key).toBe(false);
    }
    expect(isWalletDatabase('mmconnect')).toBe(true);
    expect(isWalletDatabase('digital-carat:42161:abc')).toBe(false);
  });

  it('clears the stale session even when disconnect never answers', async () => {
    vi.useFakeTimers();
    const local = memoryStorage({
      'wagmi.store': '{}',
      'wc@2:client:0.3//session': '[]',
      'sb-project-auth-token': 'keep',
      'dc-color-scheme': 'dark',
    });
    const { factory, deleted } = fakeIndexedDB(['mmconnect', 'digital-carat:42161:abc']);
    const hang = () => new Promise(() => undefined);

    const done = resetWalletSession(hang, { localStorage: local, indexedDB: factory });
    await vi.advanceTimersByTimeAsync(3_000);
    await done;
    vi.useRealTimers();

    expect(local.getItem('wagmi.store')).toBeNull();
    expect(local.getItem('wc@2:client:0.3//session')).toBeNull();
    expect(local.getItem('sb-project-auth-token')).toBe('keep');
    expect(local.getItem('dc-color-scheme')).toBe('dark');
    expect(deleted).toEqual(['mmconnect']);
  });

  it('ignores a failing disconnect', async () => {
    const local = memoryStorage({ 'wagmi.store': '{}' });
    await resetWalletSession(() => Promise.reject(new Error('Connection Not Found')), {
      localStorage: local,
    });
    expect(local.getItem('wagmi.store')).toBeNull();
  });
});

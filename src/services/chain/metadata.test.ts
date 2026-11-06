import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMetadataCache, readMetadata, trait } from './metadata';

const CID = 'ipfs://bafyTestCid';
const document = { name: 'Ruby Horizon', attributes: [{ trait_type: 'Gem Type', value: 'ruby' }] };

const ok = (body: unknown) =>
  ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as Response;
const fail = () => ({ ok: false, status: 504, statusText: 'Gateway Timeout' }) as Response;

beforeEach(() => clearMetadataCache());
afterEach(() => vi.unstubAllGlobals());

describe('token metadata', () => {
  it('fetches an immutable document only once across many readers', async () => {
    const fetchMock = vi.fn(async () => ok(document));
    vi.stubGlobal('fetch', fetchMock);

    const results = await Promise.all([readMetadata(CID), readMetadata(CID), readMetadata(CID)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.name)).toEqual(Array(3).fill('Ruby Horizon'));
  });

  it('falls over to the next gateway when one is unavailable', async () => {
    let request = 0;
    const fetchMock = vi.fn(async () => (++request === 1 ? fail() : ok(document)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(readMetadata(CID)).resolves.toMatchObject({ name: 'Ruby Horizon' });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not cache a transient failure', async () => {
    const fetchMock = vi.fn(async () => fail());
    vi.stubGlobal('fetch', fetchMock);
    await expect(readMetadata(CID)).resolves.toEqual({});

    const attemptsWhileFailing = fetchMock.mock.calls.length;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(document)),
    );

    // A retry must reach the network again rather than replay the empty result.
    await expect(readMetadata(CID)).resolves.toMatchObject({ name: 'Ruby Horizon' });
    expect(attemptsWhileFailing).toBeGreaterThan(0);
  });

  it('decodes inline data URIs without touching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const encoded = `data:application/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(document),
    )}`;

    await expect(readMetadata(encoded)).resolves.toMatchObject({ name: 'Ruby Horizon' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('decodes base64 data URIs, which is how demo inventory is seeded', async () => {
    const encoded = `data:application/json;base64,${btoa(JSON.stringify(document))}`;
    await expect(readMetadata(encoded)).resolves.toMatchObject({ name: 'Ruby Horizon' });
  });

  it('reads standard attributes case-insensitively', () => {
    expect(trait(document, 'gem type')).toBe('ruby');
    expect(trait(document, 'Carat Weight')).toBeUndefined();
    expect(trait({}, 'Gem Type')).toBeUndefined();
  });
});

describe('metadata across visits', () => {
  const uri = 'ipfs://QmPCVhkYHp62ojTJmRWXuF5paL1qSRz5qqPt3XQ9gtexz7';
  const stored = { name: 'Ruby', attributes: [{ trait_type: 'Gem Type', value: 'Ruby' }] };
  const reloadPage = () => {
    // Only the in-memory map goes on reload, so its entries are dropped directly.
    const kept = { ...localStorage };
    clearMetadataCache();
    Object.entries(kept).forEach(([key, value]) => localStorage.setItem(key, String(value)));
  };

  it('needs no network on the next visit', async () => {
    const fetchMock = vi.fn(async () => ok(stored));
    vi.stubGlobal('fetch', fetchMock);
    await readMetadata(uri);
    reloadPage();

    await expect(readMetadata(uri)).resolves.toEqual(stored);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failed read or a reply that is not token metadata', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fail())
      .mockResolvedValue(ok({ error: 'rate limited' }));
    vi.stubGlobal('fetch', fetchMock);
    await readMetadata(uri);
    await readMetadata(uri);
    reloadPage();

    await readMetadata(uri);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('only keeps content-addressed documents', async () => {
    const httpUri = 'https://example.com/metadata.json';
    const fetchMock = vi.fn(async () => ok(stored));
    vi.stubGlobal('fetch', fetchMock);
    await readMetadata(httpUri);
    reloadPage();

    await readMetadata(httpUri);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

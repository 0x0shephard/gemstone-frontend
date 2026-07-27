import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMetadataCache, readMetadata, trait } from './metadata';
import { PUBLIC_IPFS_GATEWAYS } from '@/config/ipfs';

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
    const fetchMock = vi.fn(async (url: string) =>
      url.includes(new URL(PUBLIC_IPFS_GATEWAYS[0]).host) ? fail() : ok(document),
    );
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

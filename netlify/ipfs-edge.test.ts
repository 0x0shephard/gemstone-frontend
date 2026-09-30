import { afterEach, describe, expect, it, vi } from 'vitest';
import ipfs from './edge-functions/ipfs';

const cid = 'QmTpMKYBNoPgoWMSQu61j2zUPLY6MHhoFSP5iWxPiokggo';
const request = (path: string) => new Request(`https://digitalcarat.io${path}`);

describe('IPFS edge function', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('serves gateway bytes with a durable, immutable cache policy', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('jpeg-bytes', { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const response = await ipfs(request(`/ipfs/${cid}`));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('jpeg-bytes');
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('netlify-cdn-cache-control')).toContain('durable');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(fetchMock.mock.calls[0][0]).toBe(`https://gateway.pinata.cloud/ipfs/${cid}`);
  });

  it('moves past a throttled gateway and never caches a failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await ipfs(request(`/ipfs/${cid}`))).status).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toBe(`https://ipfs.io/ipfs/${cid}`);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 429 })));
    const failed = await ipfs(request(`/ipfs/${cid}`));
    expect(failed.status).toBe(502);
    expect(failed.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses anything that is not a content-addressed path', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await ipfs(request('/ipfs/../../etc/passwd'))).status).toBe(400);
    expect((await ipfs(request('/ipfs/not-a-cid'))).status).toBe(400);
  });
});

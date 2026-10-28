// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import ipfs, { config, gatewayPath } from './edge-functions/ipfs';

const CID_V0 = 'QmVHNHvdZ6dKLjfG7hB57R88wfsRYvwUByETa2DNADzBZv';
const CID_V1 = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy';

function upstream(body: string, init: ResponseInit) {
  const fetchMock = vi.fn(async () => new Response(body, init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const get = (path: string, method = 'GET') =>
  ipfs(new Request(`https://digitalcarat.io${path}`, { method }));

afterEach(() => vi.unstubAllGlobals());

describe('/ipfs edge function', () => {
  it('is mounted on /ipfs/* with the edge cache kept', () => {
    expect(config).toEqual({ path: '/ipfs/*', cache: 'manual' });
  });

  it.each(['image/jpeg', 'application/json; charset=utf-8', 'image/webp'])(
    'serves %s locked down',
    async (type) => {
      const fetchMock = upstream('bytes', {
        status: 200,
        headers: { 'content-type': type, etag: '"x"' },
      });
      const response = await get(`/ipfs/${CID_V0}`);

      expect(fetchMock).toHaveBeenCalledWith(`https://gateway.pinata.cloud/ipfs/${CID_V0}`, {
        method: 'GET',
        signal: expect.any(AbortSignal),
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('bytes');
      expect(response.headers.get('content-type')).toBe(type.split(';')[0]);
      expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(response.headers.get('etag')).toBe('"x"');
    },
  );

  it.each(['text/html; charset=utf-8', 'image/svg+xml', 'application/javascript', 'text/xml', ''])(
    'refuses %s so a pinned page cannot run as this site',
    async (type) => {
      upstream('<script>alert(1)</script>', {
        status: 200,
        headers: type ? { 'content-type': type } : {},
      });
      const response = await get(`/ipfs/${CID_V1}`);

      expect(response.status).toBe(415);
      expect(await response.text()).not.toContain('<script>');
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
      expect(response.headers.get('cache-control')).toBe('no-store');
    },
  );

  it('does not forward a gateway error body or cache it', async () => {
    upstream('<html>rate limited</html>', {
      status: 429,
      headers: { 'content-type': 'text/html' },
    });
    const response = await get(`/ipfs/${CID_V0}`);

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('Gateway error');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers a network failure with 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network');
      }),
    );
    expect((await get(`/ipfs/${CID_V0}`)).status).toBe(502);
  });

  it('sends HEAD upstream and returns no body', async () => {
    const fetchMock = upstream('', { status: 200, headers: { 'content-type': 'image/png' } });
    const response = await get(`/ipfs/${CID_V0}`, 'HEAD');

    expect(fetchMock).toHaveBeenCalledWith(`https://gateway.pinata.cloud/ipfs/${CID_V0}`, {
      method: 'HEAD',
      signal: expect.any(AbortSignal),
    });
    expect(response.status).toBe(200);
  });

  it('refuses other methods without calling the gateway', async () => {
    const fetchMock = upstream('', { status: 200 });
    expect((await get(`/ipfs/${CID_V0}`, 'POST')).status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    '/ipfs/',
    '/ipfs/not-a-cid',
    `/ipfs/${CID_V0}/../../pinning/pinList`,
    `/ipfs/${CID_V0}/%2e%2e/%2e%2e/pinning`,
    `/ipfs/${CID_V0}/a%2F..%2Fb`,
  ])('refuses %s without calling the gateway', async (path) => {
    const fetchMock = upstream('', { status: 200 });
    expect((await get(path)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a file inside a directory CID', async () => {
    const fetchMock = upstream('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    expect(gatewayPath(`/ipfs/${CID_V1}/1.json`)).toBe(`${CID_V1}/1.json`);
    await get(`/ipfs/${CID_V1}/1.json`);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://gateway.pinata.cloud/ipfs/${CID_V1}/1.json`);
  });

  it('folds a query string onto the bare path so it cannot bust the cache', async () => {
    const fetchMock = upstream('', { status: 200 });
    const response = await get(`/ipfs/${CID_V0}?filename=x.html`);
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(`/ipfs/${CID_V0}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not forward the upstream content-length (the body may be decompressed)', async () => {
    upstream('{}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': '9' },
    });
    expect((await get(`/ipfs/${CID_V0}`)).headers.get('content-length')).not.toBe('9');
  });
});

describe('/ipfs edge function timeout', () => {
  afterEach(() => vi.useRealTimers());

  it('gives up on a gateway that sends no headers within 15 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) =>
            init.signal!.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            ),
          ),
      ),
    );
    const pending = get(`/ipfs/${CID_V0}`);
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await pending).status).toBe(502);
  });

  it('does not abort a body that is still streaming after the headers arrived', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Response('bytes', { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }),
    );
    const response = await get(`/ipfs/${CID_V0}`);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(signal?.aborted).toBe(false);
    expect(await response.text()).toBe('bytes');
  });
});

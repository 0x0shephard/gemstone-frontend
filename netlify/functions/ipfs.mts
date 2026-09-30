/**
 * Same-origin IPFS with one cached copy for every edge location.
 *
 * A plain proxy rewrite (and an edge function) was cached per edge node, so
 * each node still fetched every ~1 MB photo from the gateway once (6-7 s, and
 * throttled under load). Netlify honours the `durable` CDN directive on
 * serverless function responses, so the first request anywhere fetches the
 * bytes and every later one anywhere is served from the shared durable cache.
 * CIDs are content hashes, so the bytes never change.
 *
 * Failures (a gateway's 429, a timeout) are never cached, and the next gateway
 * is tried first, so one throttled reply cannot stick to a URL.
 */

const GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
];
const UPSTREAM_TIMEOUT_MS = 15_000;
const CID_PATH = /^\/ipfs\/([A-Za-z0-9]{32,100})((?:\/[A-Za-z0-9._~%-]+)*)$/;
const PASS_THROUGH = ['content-type', 'content-length', 'etag', 'last-modified'];

export default async function ipfs(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const match = CID_PATH.exec(pathname);
  if (!match) return new Response('Not a content-addressed path', { status: 400 });
  const path = `${match[1]}${match[2]}`;

  let last: Response | undefined;
  for (const gateway of GATEWAYS) {
    let upstream: Response;
    try {
      upstream = await fetch(`${gateway}${path}`, {
        headers: { accept: request.headers.get('accept') ?? '*/*' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      continue;
    }
    if (upstream.status === 200) {
      const headers = new Headers();
      for (const name of PASS_THROUGH) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
      }
      headers.set('access-control-allow-origin', '*');
      headers.set('cache-control', 'public, max-age=31536000, immutable');
      headers.set('netlify-cdn-cache-control', 'public, durable, max-age=31536000, immutable');
      return new Response(upstream.body, { status: 200, headers });
    }
    await upstream.body?.cancel();
    last = upstream;
  }

  return new Response(last ? `Gateway answered ${last.status}` : 'No gateway answered', {
    status: last?.status === 404 ? 404 : 502,
    headers: { 'cache-control': 'no-store' },
  });
}

export const config = { path: '/ipfs/*' };

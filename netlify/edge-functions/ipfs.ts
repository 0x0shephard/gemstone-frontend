// Same-origin IPFS for gem photos and metadata.
//
// Browsers fired bursts of ~1 MB image requests at public gateways, which
// answered many with 429 text/plain; Chrome (ORB) and Safari (CORS) then refused
// to render them, so `/ipfs/*` is served from this origin.
//
// It used to be a plain Netlify proxy rewrite, which forwarded whatever the
// gateway returned. Anyone can pin an HTML page, so a link to
// digitalcarat.io/ipfs/<cid> ran that page's script as this site, with the
// visitor's session in reach. Netlify's [[headers]] rules are not applied to
// proxied responses, so the fix has to be code: only the content types the app
// actually loads pass through, and every response forbids scripts and sniffing.
//
// `cache: 'manual'` keeps the edge cache: a CID's bytes never change, so a 200 is
// cached for a year and the gateway is asked once per edge node.

const GATEWAY = 'https://gateway.pinata.cloud/ipfs/';

// What the app loads from /ipfs: gem photos (chainService image candidates) and
// token metadata JSON (services/chain/metadata.ts). SVG is excluded on purpose:
// it can carry script.
const ALLOWED_TYPES = new Set([
  'application/json',
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

// A CIDv0 (Qm…) or base32 CIDv1 (b…), optionally followed by a path inside a
// directory CID. No `.`/`..` segments, so the request cannot climb out of /ipfs/
// on the gateway.
const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/;
const SEGMENT = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;

const LOCKED_DOWN = {
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
};

const PASSED_THROUGH = ['content-length', 'etag', 'last-modified'];

function refuse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      ...LOCKED_DOWN,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function gatewayPath(pathname: string): string | null {
  const segments = pathname.replace(/^\/ipfs\//, '').split('/');
  const [cid, ...rest] = segments;
  if (!cid || !CID.test(cid)) return null;
  if (!rest.every((segment) => SEGMENT.test(segment))) return null;
  return segments.join('/');
}

export default async function ipfs(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return refuse(405, 'Method not allowed');

  const path = gatewayPath(new URL(request.url).pathname);
  if (!path) return refuse(400, 'Not an IPFS path');

  let upstream: Response;
  try {
    upstream = await fetch(GATEWAY + path, { method: request.method });
  } catch {
    return refuse(502, 'Gateway unavailable');
  }
  // The client treats any failure as "try the next gateway", so a gateway's own
  // error body is never needed and never forwarded.
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return refuse(upstream.status === 404 ? 404 : 502, 'Gateway error');
  }

  const type = (upstream.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    await upstream.body?.cancel();
    return refuse(415, 'Unsupported content type');
  }

  const headers = new Headers({
    ...LOCKED_DOWN,
    'Content-Type': type,
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  for (const name of PASSED_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: 200, headers });
}

export const config = { path: '/ipfs/*', cache: 'manual' };

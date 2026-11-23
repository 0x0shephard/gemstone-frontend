/**
 * What may leave the browser about the page a visitor is on.
 *
 * Some addresses carry secrets: `/gift/<code>` holds a gift card's claim code,
 * and Supabase sign-in links return with tokens in the query or the hash. Ad
 * and analytics tools record the page address with every event, so they get a
 * cleaned version: the route pattern, plus only the campaign (`utm_*`) tags.
 */

export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

export type UtmTags = Partial<Record<(typeof UTM_KEYS)[number], string>>;

/** Campaign tags from a query string, trimmed and capped; nothing else. */
export function readUtm(search: string): UtmTags {
  const params = new URLSearchParams(search);
  const tags: UtmTags = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim();
    if (value) tags[key] = value.slice(0, 100);
  }
  return tags;
}

/** The path with secret segments replaced by their route parameter. */
export function analyticsPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (/^\/gift\/[^/]+/.test(path)) return '/gift/:code';
  return path;
}

/** A same-site URL reduced to origin, cleaned path and campaign tags. */
export function sanitizeUrl(url: string, origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url, origin);
  } catch {
    return url;
  }
  if (parsed.origin !== origin) return `${parsed.origin}${parsed.pathname}`;
  const utm = new URLSearchParams(readUtm(parsed.search) as Record<string, string>).toString();
  return `${origin}${analyticsPath(parsed.pathname)}${utm ? `?${utm}` : ''}`;
}

/**
 * Whether an ad pixel may see this page at all. The Meta Pixel reads the full
 * address itself, so pages that can hold a secret are skipped entirely.
 */
export function pageIsShareable(location: { pathname: string; search: string; hash: string }) {
  if (/^\/gift\/[^/]+/.test(location.pathname)) return false;
  if (location.pathname.startsWith('/canva/')) return false;
  return !/(access_token|refresh_token|token_hash|provider_token|error_description)=/.test(
    `${location.search}${location.hash}`,
  );
}

/** Recursively cleans every same-site URL in an event's properties. */
export function sanitizeProperties<T>(value: T, origin: string, key = ''): T {
  if (typeof value === 'string') {
    // `$pathname`, `$session_entry_pathname`, `$initial_pathname`, …
    if (/pathname$/i.test(key)) return analyticsPath(value) as T;
    return (value.startsWith(origin) ? sanitizeUrl(value, origin) : value) as T;
  }
  if (Array.isArray(value)) return value.map((child) => sanitizeProperties(child, origin)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitizeProperties(child, origin, childKey),
      ]),
    ) as T;
  }
  return value;
}

/** Appends the current campaign tags to a link, so they survive an email round trip. */
export function withUtm(link: string, tags: UtmTags): string {
  const entries = Object.entries(tags);
  if (entries.length === 0) return link;
  const url = new URL(link);
  for (const [key, value] of entries) {
    if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  return url.toString();
}

function configuredOrigins(): URL[] {
  const raw = Deno.env.get('SITE_ORIGINS') ?? Deno.env.get('SITE_ORIGIN') ?? '';
  const origins = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(value))
    .map((value) => new URL(value.origin));
  if (origins.length === 0) throw new Error('No allowed site origins are configured');
  return origins;
}

export function resolveSiteOrigin(domain: unknown, uri: unknown): URL | undefined {
  if (typeof domain !== 'string' || typeof uri !== 'string') return undefined;
  let requested: URL;
  try {
    requested = new URL(uri);
  } catch {
    return undefined;
  }
  if (requested.origin !== uri || requested.host !== domain) return undefined;
  return configuredOrigins().find(
    (allowed) => allowed.origin === requested.origin && allowed.host === domain,
  );
}

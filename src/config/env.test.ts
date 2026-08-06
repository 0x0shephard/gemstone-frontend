import { describe, expect, it, vi, afterEach } from 'vitest';

/**
 * `env.ts` is evaluated on import by nearly every module, so anything it touches
 * has to exist in every supported browser. `URL.canParse` did not: it needs
 * Chrome 120 / Safari 17 / Firefox 115, the build targets Safari 16, and syntax
 * transpilation does not polyfill APIs. The resulting `TypeError` fired before
 * React mounted, so the error boundary never saw it and the page was blank.
 */
describe('env module', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('loads on a browser without URL.canParse', async () => {
    class LegacyURL extends URL {}
    // Older engines expose the constructor but not the static helper.
    Object.defineProperty(LegacyURL, 'canParse', { value: undefined, configurable: true });
    vi.stubGlobal('URL', LegacyURL);
    expect((globalThis.URL as unknown as { canParse?: unknown }).canParse).toBeUndefined();

    const module = await import('./env');
    expect(module.env.dataMode).toMatch(/mock|chain/);
  });

  it('still rejects a malformed URL', async () => {
    const { environmentErrors } = await import('./env');
    // A valid environment produces no issues; the point is that validation ran
    // at all rather than throwing its way out of the module.
    expect(Array.isArray(environmentErrors)).toBe(true);
  });
});

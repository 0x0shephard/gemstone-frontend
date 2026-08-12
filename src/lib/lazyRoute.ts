import { lazy, type ComponentType } from 'react';

/**
 * `React.lazy` that survives a deploy landing mid-session.
 *
 * Vite fingerprints every chunk, and Netlify publishes atomically: the moment a
 * new build goes live the previous build's filenames stop existing. A browser
 * holding the old `index.html` still references them, so the next route change
 * throws "Failed to fetch dynamically imported module" — for a page that is
 * perfectly healthy, on a site that is perfectly up.
 *
 * Reloading fixes it because the reload fetches the current HTML with the
 * current hashes. That is what this does automatically, once.
 */

const RELOAD_FLAG = 'dc:chunk-reload';

/** Storage is unavailable in some privacy modes; failing to read must not throw. */
function readFlag(): string | null {
  try {
    return sessionStorage.getItem(RELOAD_FLAG);
  } catch {
    return null;
  }
}

function writeFlag(value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(RELOAD_FLAG);
    else sessionStorage.setItem(RELOAD_FLAG, value);
  } catch {
    /* Nothing to do — the retry simply will not be suppressed. */
  }
}

/**
 * True for the specific failure of a chunk that is no longer on the server.
 *
 * Narrow on purpose: a genuine syntax error inside a module also rejects the
 * import, and reloading the page for that would produce a loop that hides the
 * real fault instead of showing it.
 */
function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message)
  );
}

/**
 * Loads a chunk, reloading the page once if it has been deployed away.
 *
 * Exported separately from {@link lazyRoute} so the recovery can be tested
 * without reaching into React's lazy internals to trigger the factory.
 */
export function loadChunk<T>(factory: () => Promise<T>): Promise<T> {
  return factory().then(
    (module) => {
      // A successful load means what is running matches the server, so a later
      // failure deserves its own reload rather than inheriting a spent flag.
      writeFlag(null);
      return module;
    },
    (error: unknown) => {
      if (!isStaleChunkError(error) || readFlag()) throw error;
      writeFlag('1');
      window.location.reload();
      // The page is being replaced; never resolving avoids flashing an error
      // boundary for the moment before it goes.
      return new Promise<T>(() => {});
    },
  );
}

// Mirrors React's own `lazy` signature. `ComponentType<any>` is what React
// declares, and narrowing it here rejects perfectly valid components that take
// props — `Web3Providers` takes `children`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRoute<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() => loadChunk(factory));
}

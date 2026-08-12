import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadChunk } from './lazyRoute';

const reload = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  reload.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
});

afterEach(() => sessionStorage.clear());

const staleChunk = () =>
  Promise.reject(
    new TypeError(
      'Failed to fetch dynamically imported module: https://digitalcarat.io/assets/LandingPage-DLOadT1f.js',
    ),
  );

describe('loadChunk', () => {
  it('reloads once when a chunk has been replaced by a deploy', async () => {
    // Never settles — the page is being replaced — so the reload is the assertion.
    void loadChunk(staleChunk);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('does not reload twice, so a persistent failure surfaces', async () => {
    sessionStorage.setItem('dc:chunk-reload', '1');
    await expect(loadChunk(staleChunk)).rejects.toThrow(/failed to fetch/i);
    expect(reload).not.toHaveBeenCalled();
  });

  it('rethrows a real module error rather than looping on it', async () => {
    // A syntax error inside the module also rejects the import. Reloading for
    // that would hide the fault behind an endless refresh.
    const broken = () => Promise.reject(new SyntaxError('Unexpected token'));
    await expect(loadChunk(broken)).rejects.toThrow(SyntaxError);
    expect(reload).not.toHaveBeenCalled();
  });

  it('clears the flag after a successful load', async () => {
    sessionStorage.setItem('dc:chunk-reload', '1');
    await loadChunk(() => Promise.resolve({ default: () => null }));
    expect(sessionStorage.getItem('dc:chunk-reload')).toBeNull();
  });
});

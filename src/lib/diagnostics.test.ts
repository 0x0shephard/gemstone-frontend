import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildDiagnosticReport,
  clearDiagnostics,
  diagnosticsEnabled,
  readDiagnostics,
  recordDiagnostic,
} from './diagnostics';

describe('diagnostics trail', () => {
  beforeEach(() => localStorage.clear());

  it('keeps only the most recent entries', () => {
    for (let index = 0; index < 160; index += 1) recordDiagnostic('page', `event ${index}`);
    const entries = readDiagnostics();
    expect(entries).toHaveLength(150);
    expect(entries[0].message).toBe('event 10');
    expect(entries.at(-1)?.message).toBe('event 159');
  });

  it('never stores email addresses, in messages or details', () => {
    recordDiagnostic('server', 'v1-gift-notify: could not reach friend@example.com', {
      to: 'friend@example.com',
    });
    const [entry] = readDiagnostics();
    expect(entry.message).toBe('v1-gift-notify: could not reach [email]');
    expect(entry.detail?.to).toBe('[email]');
  });

  it('drops entries older than a day', () => {
    localStorage.setItem(
      'dc:diagnostics:v1',
      JSON.stringify([{ at: Date.now() - 25 * 3_600_000, kind: 'page', message: 'old' }]),
    );
    recordDiagnostic('page', 'new');
    expect(readDiagnostics().map((entry) => entry.message)).toEqual(['new']);
  });

  it('turns the panel on and off from the URL and remembers it across pages', () => {
    expect(diagnosticsEnabled('')).toBe(false);
    expect(diagnosticsEnabled('?debug=1')).toBe(true);
    expect(diagnosticsEnabled('?other=1')).toBe(true);
    expect(diagnosticsEnabled('?debug=0')).toBe(false);
  });

  it('writes a plain-text report with wallet, pending work and events', () => {
    recordDiagnostic('tx', 'broadcast outcome unknown; retry locked', { step: 0 });
    const report = buildDiagnosticReport({
      build: 'abc1234',
      url: '/swaps',
      userAgent: 'iPhone Safari',
      configuredChainId: 11155111,
      wallet: { status: 'connected', connector: 'MetaMask', account: '0x1', chainId: 1 },
      pendingWork: [
        { flow: 'swap_accept', label: 'Accept swap', age: '2m ago', steps: 'call=broadcast' },
      ],
    });
    expect(report).toContain('Build abc1234 · /swaps');
    expect(report).toContain('App chain 11155111 · wallet chain 1');
    expect(report).toContain('Wallet connected via MetaMask · 0x1');
    expect(report).toContain('- swap_accept: Accept swap · 2m ago · call=broadcast');
    expect(report).toMatch(/tx {5}broadcast outcome unknown; retry locked step=0/);
    clearDiagnostics();
    expect(readDiagnostics()).toEqual([]);
  });
});

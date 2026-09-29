/**
 * A local, always-on record of what the app saw, for phone bug reports.
 *
 * Wallet failures on phones happen across an app switch: the browser is
 * suspended while MetaMask is in front and may be reloaded or replaced on the
 * way back. By the time someone notices, the moment has passed and a screen
 * recording shows only the symptom. This keeps a short trail of the events
 * around it — visibility changes, wallet status, transaction stages, server
 * errors — so a report can say what actually happened.
 *
 * Nothing here leaves the device. `localStorage` rather than memory or session
 * storage, because the MetaMask return frequently lands in a fresh tab. The
 * panel that reads it is opt-in (`?debug=1`); recording is not, so the trail
 * already exists when someone turns the panel on after a failure.
 */

const LOG_KEY = 'dc:diagnostics:v1';
const FLAG_KEY = 'dc:debug';
const MAX_ENTRIES = 150;
const MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g;

export type DiagnosticKind = 'page' | 'wallet' | 'tx' | 'server' | 'chain' | 'error';

export interface DiagnosticEntry {
  at: number;
  kind: DiagnosticKind;
  message: string;
  detail?: Record<string, string | number | boolean | null>;
}

function redact(value: string): string {
  return value.replace(EMAIL, '[email]').slice(0, 300);
}

export function readDiagnostics(): DiagnosticEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as DiagnosticEntry[];
    const cutoff = Date.now() - MAX_AGE_MS;
    return Array.isArray(parsed) ? parsed.filter((entry) => entry.at > cutoff) : [];
  } catch {
    return [];
  }
}

export function recordDiagnostic(
  kind: DiagnosticKind,
  message: string,
  detail?: DiagnosticEntry['detail'],
): void {
  try {
    const entry: DiagnosticEntry = {
      at: Date.now(),
      kind,
      message: redact(message),
      ...(detail && {
        detail: Object.fromEntries(
          Object.entries(detail).map(([key, value]) => [
            key,
            typeof value === 'string' ? redact(value) : value,
          ]),
        ),
      }),
    };
    const entries = [...readDiagnostics(), entry].slice(-MAX_ENTRIES);
    localStorage.setItem(LOG_KEY, JSON.stringify(entries));
    window.dispatchEvent(new Event('dc:diagnostics'));
  } catch {
    // Diagnostics must never be the reason something else fails.
  }
}

export function clearDiagnostics(): void {
  try {
    localStorage.removeItem(LOG_KEY);
    window.dispatchEvent(new Event('dc:diagnostics'));
  } catch {
    /* Nothing to clear in an unwritable store. */
  }
}

/**
 * `?debug=1` turns the panel on and `?debug=0` turns it off. Kept in storage so
 * it survives the wallet round trip, which rarely returns to the same URL.
 */
export function diagnosticsEnabled(search = window.location.search): boolean {
  try {
    const flag = new URLSearchParams(search).get('debug');
    if (flag === '1') localStorage.setItem(FLAG_KEY, '1');
    if (flag === '0') localStorage.removeItem(FLAG_KEY);
    return localStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** Page lifecycle and uncaught failures, which no component sees on its own. */
export function watchPageDiagnostics(): () => void {
  const onVisibility = () => recordDiagnostic('page', `visibility ${document.visibilityState}`);
  const onPageShow = (event: PageTransitionEvent) =>
    recordDiagnostic('page', event.persisted ? 'restored from back-forward cache' : 'page shown');
  const onPageHide = () => recordDiagnostic('page', 'page hidden');
  const onOnline = () => recordDiagnostic('page', 'network online');
  const onOffline = () => recordDiagnostic('page', 'network offline');
  const onError = (event: ErrorEvent) =>
    recordDiagnostic('error', event.message || 'Uncaught error', {
      source: event.filename ? (event.filename.split('/').pop() ?? '') : '',
      line: event.lineno,
    });
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason as { shortMessage?: unknown; message?: unknown } | undefined;
    const text =
      typeof reason?.shortMessage === 'string'
        ? reason.shortMessage
        : typeof reason?.message === 'string'
          ? reason.message
          : String(event.reason);
    recordDiagnostic('error', `Unhandled rejection: ${text}`);
  };
  // Sync events fire on every poll; only a change of state is worth a line.
  let lastSyncState: string | undefined;
  const onChainSync = (event: Event) => {
    const detail = (event as CustomEvent<{ state?: string; latestBlock?: string }>).detail;
    if (!detail?.state || detail.state === lastSyncState) return;
    lastSyncState = detail.state;
    recordDiagnostic('chain', `chain sync ${detail.state}`, {
      latestBlock: detail.latestBlock ?? null,
    });
  };

  recordDiagnostic('page', 'app loaded', { path: window.location.pathname });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('dc:chain-sync', onChainSync);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('dc:chain-sync', onChainSync);
  };
}

export interface DiagnosticSnapshot {
  build: string;
  url: string;
  userAgent: string;
  configuredChainId: number;
  wallet: {
    status: string;
    connector?: string;
    account?: string;
    chainId?: number;
  };
  pendingWork: Array<{ flow: string; label: string; age: string; steps: string }>;
}

function clock(at: number): string {
  return new Date(at).toISOString().slice(11, 19);
}

/** Plain text, so it pastes cleanly into WhatsApp, email or a ticket. */
export function buildDiagnosticReport(
  snapshot: DiagnosticSnapshot,
  entries: DiagnosticEntry[] = readDiagnostics(),
): string {
  const { wallet } = snapshot;
  const lines = [
    `Digital Carat diagnostics · ${new Date().toISOString()}`,
    `Build ${snapshot.build} · ${snapshot.url}`,
    `Browser ${snapshot.userAgent}`,
    `App chain ${snapshot.configuredChainId} · wallet chain ${wallet.chainId ?? 'none'}`,
    `Wallet ${wallet.status}${wallet.connector ? ` via ${wallet.connector}` : ''}${
      wallet.account ? ` · ${wallet.account}` : ''
    }`,
    '',
    `Pending wallet work (${snapshot.pendingWork.length})`,
    ...snapshot.pendingWork.map(
      (work) => `- ${work.flow}: ${work.label} · ${work.age} · ${work.steps}`,
    ),
    '',
    `Recent events (${entries.length}, UTC)`,
    ...entries.map(
      (entry) =>
        `${clock(entry.at)} ${entry.kind.padEnd(6)} ${entry.message}${
          entry.detail
            ? ` ${Object.entries(entry.detail)
                .map(([key, value]) => `${key}=${value}`)
                .join(' ')}`
            : ''
        }`,
    ),
  ];
  return lines.join('\n');
}

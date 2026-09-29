import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { env } from '@/config/env';
import {
  buildDiagnosticReport,
  clearDiagnostics,
  diagnosticsEnabled,
  readDiagnostics,
  type DiagnosticSnapshot,
} from '@/lib/diagnostics';
import { listPendingWork } from '@/services/chain/pendingWork';

function age(createdAt: number): string {
  const minutes = Math.round((Date.now() - createdAt) / 60_000);
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

/**
 * Hidden support panel, shown only after `?debug=1`.
 *
 * Built for one job: turning "it didn't work on my phone" into a report that
 * says which wallet, which chain, what was in flight and what the app saw
 * around the failure. Read-only by design — it offers no way to clear a
 * transaction lock, because a lock exists precisely when a second send could
 * pay twice.
 */
export function DiagnosticsPanel() {
  const [enabled] = useState(() => diagnosticsEnabled());
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(readDiagnostics);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const { status, connector, chainId, address } = useAccount();

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => setEntries(readDiagnostics());
    window.addEventListener('dc:diagnostics', refresh);
    return () => window.removeEventListener('dc:diagnostics', refresh);
  }, [enabled]);

  if (!enabled) return null;

  const pending = listPendingWork();
  const snapshot: DiagnosticSnapshot = {
    build: __BUILD_COMMIT__,
    url: `${window.location.pathname}${window.location.search}`,
    userAgent: navigator.userAgent,
    configuredChainId: env.chainId,
    wallet: { status, connector: connector?.name, account: address, chainId },
    pendingWork: pending.map((work) => ({
      flow: work.flow,
      label: work.label,
      age: age(work.createdAt),
      steps: work.steps
        .map(
          (step) =>
            `${step.label}=${step.status}${step.hash ? `(${step.hash.slice(0, 10)}…)` : ''}`,
        )
        .join(', '),
    })),
  };
  const report = buildDiagnosticReport(snapshot, entries);

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-24 left-3 z-[60] rounded-[4px] border border-amber/40 bg-panel px-2.5 py-1.5 font-mono text-[11px] text-amber shadow-lg lg:bottom-4"
        >
          Diagnostics{pending.length ? ` · ${pending.length} pending` : ''}
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        maxWidth={640}
        title="Diagnostics"
        subtitle="Stored only on this device. Copy the report to share it."
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-ink-dim">Build</dt>
          <dd className="font-mono text-ink">{snapshot.build}</dd>
          <dt className="text-ink-dim">Wallet</dt>
          <dd className="font-mono text-ink">
            {status}
            {connector ? ` · ${connector.name}` : ''}
          </dd>
          <dt className="text-ink-dim">Chain</dt>
          <dd
            className={
              chainId && chainId !== env.chainId ? 'font-mono text-ruby' : 'font-mono text-ink'
            }
          >
            wallet {chainId ?? 'none'} · app {env.chainId}
          </dd>
          <dt className="text-ink-dim">Pending</dt>
          <dd className="font-mono text-ink">
            {pending.length
              ? snapshot.pendingWork.map((work) => `${work.flow} (${work.age})`).join(', ')
              : 'none'}
          </dd>
        </dl>
        <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-[4px] border border-line/[0.08] bg-vault p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-muted">
          {report}
        </pre>
        <div className="grid grid-cols-3 gap-2">
          <Button onClick={() => void copy()}>
            {copied === 'copied' ? 'Copied ✓' : copied === 'failed' ? 'Copy failed' : 'Copy report'}
          </Button>
          <Button variant="ghost" onClick={clearDiagnostics}>
            Clear log
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              window.location.search = '?debug=0';
            }}
          >
            Turn off
          </Button>
        </div>
      </Modal>
    </>
  );
}

import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { recordDiagnostic, watchPageDiagnostics } from '@/lib/diagnostics';

/**
 * Feeds the local diagnostics trail. Always mounted and renders nothing; the
 * panel that reads the trail is separate and opt-in.
 */
export function DiagnosticsRecorder() {
  useEffect(watchPageDiagnostics, []);

  const { status, connector, chainId, address } = useAccount();
  const connectorName = connector?.name;
  useEffect(() => {
    recordDiagnostic('wallet', `status ${status}`, {
      connector: connectorName ?? null,
      chainId: chainId ?? null,
      account: address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null,
    });
  }, [status, connectorName, chainId, address]);

  return null;
}

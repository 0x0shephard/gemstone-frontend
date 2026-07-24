import { useEffect, useState } from 'react';
import { env } from '@/config/env';
import { StatusBadge } from '@/components/ui/StatusBadge';

type SyncDetail = {
  state: 'syncing' | 'synced' | 'stale';
  scannedThrough?: string;
  latestBlock?: string;
  cached?: boolean;
};

export function ChainSyncStatus() {
  const [status, setStatus] = useState<SyncDetail>({ state: 'syncing' });
  useEffect(() => {
    const listener = (event: Event) => setStatus((event as CustomEvent<SyncDetail>).detail);
    window.addEventListener('dc:chain-sync', listener);
    return () => window.removeEventListener('dc:chain-sync', listener);
  }, []);
  if (env.dataMode === 'mock') return <StatusBadge tone="neutral">Mock data</StatusBadge>;
  if (status.state === 'stale') {
    return (
      <StatusBadge tone="warning" dot>
        Cached · RPC stale
      </StatusBadge>
    );
  }
  if (status.state === 'syncing') {
    return (
      <StatusBadge tone="warning" dot>
        Syncing chain
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="success" dot>
      Synced · block {status.latestBlock}
    </StatusBadge>
  );
}

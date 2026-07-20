import { useCallback, useSyncExternalStore } from 'react';
import { env, isConfigured } from '@/config/env';

export type KycState = 'none' | 'pending' | 'approved' | 'rejected';

const KEY = 'dc.kycStatus';

/**
 * Seller KYC status. The real flow mints a Sumsub access token from a backend
 * (`VITE_SUMSUB_BACKEND_URL`) — never a frontend secret. Here we track a local
 * mock status so seller-gated UI is demonstrable; `beginKyc` would POST to the
 * backend to obtain a token in production.
 */
function read(): KycState {
  return (localStorage.getItem(KEY) as KycState) || 'none';
}

function subscribe(cb: () => void) {
  window.addEventListener('storage', cb);
  window.addEventListener('dc:kyc', cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener('dc:kyc', cb);
  };
}

export function useKyc() {
  const status = useSyncExternalStore(subscribe, read, () => 'none' as KycState);

  const set = useCallback((next: KycState) => {
    localStorage.setItem(KEY, next);
    window.dispatchEvent(new Event('dc:kyc'));
  }, []);

  const beginKyc = useCallback(() => {
    // In production: fetch(`${env.sumsubBackendUrl}/token`) → open Sumsub SDK.
    // Mock: move to pending, then auto-approve to demonstrate the gated flow.
    set('pending');
    setTimeout(() => set('approved'), 1500);
  }, [set]);

  return {
    status,
    backendConfigured: isConfigured(env.sumsubBackendUrl),
    isApproved: status === 'approved',
    beginKyc,
    set,
  };
}

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const CHAIN_QUERY_ROOTS = new Set([
  'gems',
  'gem',
  'listings',
  'auctions',
  'auction',
  'offers',
  'swaps',
  'redemptions',
  'profile',
  'landing',
  'feeTiers',
  'paymentAssets',
  'pendingAuctionRefunds',
  'pendingTreasuryPayout',
]);
let foregroundRefresh: Promise<void> | undefined;
let foregroundRefreshQueued = false;

/** Coalesced refresh for mounted protocol views; unrelated app queries are untouched. */
export function refreshChainQueries(): Promise<void> {
  if (foregroundRefresh) {
    foregroundRefreshQueued = true;
    return foregroundRefresh;
  }
  foregroundRefresh ??= queryClient
    .invalidateQueries({
      predicate: (query) => CHAIN_QUERY_ROOTS.has(String(query.queryKey[0])),
      refetchType: 'active',
    })
    .finally(() => {
      foregroundRefresh = undefined;
      if (foregroundRefreshQueued) {
        foregroundRefreshQueued = false;
        void refreshChainQueries();
      }
    });
  return foregroundRefresh;
}

/**
 * Gem, listing, and auction views render from contract state before the event
 * projection finishes. Refetching once it settles backfills the parts that only
 * logs can answer: auction bid counts, activity, and past bids.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('dc:chain-sync', (event) => {
    const { state } = (event as CustomEvent<{ state?: string }>).detail ?? {};
    if (state === 'synced' || state === 'stale') void refreshChainQueries();
  });
  // Fired after the new projection snapshot has actually been published. The
  // lower-level `synced` event occurs just before that assignment, so relying on
  // it alone can refetch the portfolio one tick too early on a cold phone.
  window.addEventListener('dc:chain-snapshot-ready', () => {
    void refreshChainQueries();
  });
  const refreshOnReturn = () => {
    if (document.visibilityState === 'visible') void refreshChainQueries();
  };
  document.addEventListener('visibilitychange', refreshOnReturn);
  window.addEventListener('focus', refreshOnReturn);
  window.addEventListener('pageshow', refreshOnReturn);
  window.addEventListener('dc:transaction-confirmed', refreshOnReturn);
  window.setInterval(refreshOnReturn, 30_000);
}

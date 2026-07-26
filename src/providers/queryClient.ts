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

/**
 * Gem, listing, and auction views render from contract state before the event
 * projection finishes. Refetching once it settles backfills the parts that only
 * logs can answer: auction bid counts, activity, and past bids.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('dc:chain-sync', (event) => {
    const { state } = (event as CustomEvent<{ state?: string }>).detail ?? {};
    if (state === 'synced' || state === 'stale') void queryClient.invalidateQueries();
  });
}

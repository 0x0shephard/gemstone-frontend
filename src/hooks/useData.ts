import { useMemo } from 'react';
import { bidSummaries } from '@/services/chain/bidSummary';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataService } from '@/services';
import { listRedemptionWorkflows } from '@/services/offchain/redemptions';

/** Query keys — centralized so mutations can invalidate precisely. */
export const qk = {
  gems: ['gems'] as const,
  gem: (id: string) => ['gem', id] as const,
  listings: ['listings'] as const,
  auctions: ['auctions'] as const,
  auction: (id: string) => ['auction', id] as const,
  offers: ['offers'] as const,
  swaps: ['swaps'] as const,
  redemptions: ['redemptions'] as const,
  redemptionWorkflows: (profileId?: string) =>
    ['redemptionWorkflows', profileId ?? 'signed-out'] as const,
  profile: (address?: string) => ['profile', address ?? 'me'] as const,
  landing: ['landing'] as const,
  feeTiers: ['feeTiers'] as const,
  bidPolicy: ['bidPolicy'] as const,
  paymentAssets: ['paymentAssets'] as const,
  pendingRefunds: (address?: string) => ['pendingRefunds', address ?? 'disconnected'] as const,
  pendingReserveCredits: (address?: string) =>
    ['pendingReserveCredits', address ?? 'disconnected'] as const,
  pendingTreasuryPayout: (address?: string) =>
    ['pendingTreasuryPayout', address ?? 'disconnected'] as const,
};

export const useGems = () => useQuery({ queryKey: qk.gems, queryFn: () => dataService.getGems() });
export const useGem = (id: string) =>
  useQuery({
    queryKey: qk.gem(id),
    queryFn: () => dataService.getGem(BigInt(id)),
    enabled: /^\d+$/.test(id),
  });
export const useListings = () =>
  useQuery({ queryKey: qk.listings, queryFn: () => dataService.getListings() });
/** A contract constant, so it is read once per session. */
/**
 * The grace period is a contract constant, but the policy also carries whether
 * each contract is paused, which is not, so it is refreshed every minute.
 */
export const useBidPolicy = () =>
  useQuery({
    queryKey: qk.bidPolicy,
    queryFn: () => dataService.getBidPolicy(),
    staleTime: 60_000,
  });
export const useAuctions = () =>
  useQuery({ queryKey: qk.auctions, queryFn: () => dataService.getAuctions() });
export const useAuction = (id: string) =>
  useQuery({
    queryKey: qk.auction(id),
    queryFn: () => dataService.getAuction(BigInt(id)),
    enabled: /^\d+$/.test(id),
  });
export const useOffers = () =>
  useQuery({ queryKey: qk.offers, queryFn: () => dataService.getOffers() });

/** Winning bid and bidder count per token id, from the same offer history. */
export function useBidSummaries() {
  const { data: offers } = useOffers();
  return useMemo(() => bidSummaries(offers ?? []), [offers]);
}
export const useSwaps = () =>
  useQuery({ queryKey: qk.swaps, queryFn: () => dataService.getSwapRequests() });
export const useRedemptions = () =>
  useQuery({ queryKey: qk.redemptions, queryFn: () => dataService.getRedemptions() });
export const useRedemptionWorkflows = (profileId?: string) =>
  useQuery({
    queryKey: qk.redemptionWorkflows(profileId),
    queryFn: listRedemptionWorkflows,
    enabled: Boolean(profileId),
  });
export const useProfile = (address?: string) =>
  useQuery({ queryKey: qk.profile(address), queryFn: () => dataService.getProfile(address) });
export const useLanding = () =>
  useQuery({ queryKey: qk.landing, queryFn: () => dataService.getLanding() });
export const useFeeTiers = () =>
  useQuery({ queryKey: qk.feeTiers, queryFn: () => dataService.getFeeTiers() });
export const usePaymentAssets = () =>
  useQuery({ queryKey: qk.paymentAssets, queryFn: () => dataService.getPaymentAssets() });
/** Auction and marketplace credits the address can withdraw, per contract and asset. */
export const usePendingRefunds = (address?: string) =>
  useQuery({
    queryKey: qk.pendingRefunds(address),
    queryFn: () => dataService.getPendingRefunds(address),
    enabled: Boolean(address),
  });
export const usePendingReserveCredits = (address?: string) =>
  useQuery({
    queryKey: qk.pendingReserveCredits(address),
    queryFn: () => dataService.getPendingReserveCredits(address),
    enabled: Boolean(address),
  });
export const usePendingTreasuryPayout = (address?: string) =>
  useQuery({
    queryKey: qk.pendingTreasuryPayout(address),
    queryFn: () => dataService.getPendingTreasuryPayout(address),
    enabled: Boolean(address),
  });

/**
 * Generic write helper: runs a data-service action, then invalidates queries so
 * the UI reflects the (mock) result. Returns a TanStack mutation.
 */
export function useTxAction<Args extends unknown[]>(
  action: (...args: Args) => Promise<{ hash: `0x${string}` }>,
  invalidate: readonly unknown[][] = [],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: Args) => action(...args),
    onSuccess: () => {
      invalidate.forEach((key) => qc.invalidateQueries({ queryKey: key }));
    },
  });
}

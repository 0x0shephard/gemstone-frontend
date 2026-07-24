import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { env, isConfigured } from '@/config/env';
import { getKycStatus, issueSumsubToken, type KycStatus } from '@/services/offchain/workflows';

const KYC_KEY = ['kyc-status'] as const;

export function useKyc() {
  const client = useQuery({
    queryKey: KYC_KEY,
    queryFn: getKycStatus,
    enabled: isConfigured(env.supabaseUrl),
    refetchInterval: 15_000,
  });
  const queryClient = useQueryClient();
  const begin = useMutation({
    mutationFn: issueSumsubToken,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KYC_KEY }),
  });
  const status: KycStatus = client.data ?? 'not_started';
  return {
    status,
    backendConfigured: isConfigured(env.sumsubBackendUrl) || isConfigured(env.supabaseUrl),
    isApproved: status === 'approved',
    beginKyc: begin.mutateAsync,
    accessToken: begin.data?.token,
    isStarting: begin.isPending,
    error: begin.error ?? client.error,
  };
}

export type { KycStatus };

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { loadOperationsAccess, type OperationsCapability } from '@/services/offchain/operations';

export function useOperationsAccess() {
  const { user, loading: authLoading } = useAuth();
  const query = useQuery({
    queryKey: ['operations', 'access', user?.id],
    queryFn: loadOperationsAccess,
    enabled: !authLoading && Boolean(user),
    staleTime: 60_000,
    retry: false,
  });

  const has = (capability: OperationsCapability) =>
    query.data?.capabilities.includes(capability) === true;

  return {
    ...query,
    authLoading,
    user,
    has,
  };
}

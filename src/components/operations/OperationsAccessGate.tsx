import type { ReactNode } from 'react';
import type { OperationsCapability } from '@/services/offchain/operations';
import { Skeleton } from '@/components/ui/States';
import { useOperationsAccess } from '@/hooks/useOperationsAccess';

export function OperationsAccessGate({
  capability,
  children,
}: {
  capability: OperationsCapability;
  children: ReactNode;
}) {
  const { user, authLoading, isLoading, isFetching, isError, data, has, refetch } =
    useOperationsAccess();

  if (authLoading || (user && isLoading)) {
    return (
      <div className="space-y-3" aria-label="Loading portal access">
        <Skeleton className="h-24" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (user && isError && !data) {
    return (
      <div
        role="alert"
        className="mx-auto my-12 max-w-xl rounded-[4px] border border-amber/25 bg-amber/[0.06] p-5 text-center"
      >
        <h2 className="font-display text-[20px] font-medium text-ink">
          Access could not be checked
        </h2>
        <p className="mt-2 text-[13px] text-ink-muted">
          The permissions service did not respond. No staff data is shown until access is verified.
        </p>
        <button
          type="button"
          className="mt-4 text-[12px] font-semibold text-amber underline"
          onClick={() => void refetch()}
        >
          Retry access check
        </button>
      </div>
    );
  }

  if (!user || !data || !has(capability)) {
    return (
      <div className="mx-auto w-full max-w-content px-6 py-24 text-center">
        <h2 className="font-display text-[28px] font-medium text-ink">Page not found</h2>
        <p className="mt-3 text-[14px] text-ink-muted">
          This address does not correspond to anything you can access.
        </p>
      </div>
    );
  }

  return (
    <>
      {isError && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-amber/25 bg-amber/[0.06] px-4 py-3 text-[12px] text-amber"
        >
          <span>Access refresh failed. The last verified permissions remain visible.</span>
          <button type="button" className="font-semibold underline" onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      )}
      {isFetching && !isLoading && (
        <p className="sr-only" role="status">
          Refreshing portal access
        </p>
      )}
      {children}
    </>
  );
}

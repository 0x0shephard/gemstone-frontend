import { useCallback, useEffect, useRef } from 'react';
import { captureClaimStep, type ClaimStep } from '@/lib/telemetry';

/**
 * Reports a claim page's funnel steps, each once per page visit. `code` is only
 * passed for public promotional codes; a gift card's code is secret.
 */
export function useClaimFunnel(flow: 'promo' | 'gift', code: string | undefined, ready: boolean) {
  const reported = useRef(new Set<ClaimStep>());

  const report = useCallback(
    (step: ClaimStep, result?: string) => {
      if (reported.current.has(step)) return;
      reported.current.add(step);
      captureClaimStep(step, { flow, ...(code ? { code } : {}), ...(result ? { result } : {}) });
    },
    [flow, code],
  );

  useEffect(() => {
    if (ready) report('viewed');
  }, [ready, report]);

  return report;
}

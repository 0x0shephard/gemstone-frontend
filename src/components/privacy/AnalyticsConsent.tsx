import { useSyncExternalStore } from 'react';
import { hasAnalyticsConsent, setAnalyticsConsent } from '@/lib/telemetry';

function subscribe(callback: () => void) {
  window.addEventListener('dc:analytics-consent', callback);
  return () => window.removeEventListener('dc:analytics-consent', callback);
}

export function AnalyticsConsent() {
  const enabled = useSyncExternalStore(subscribe, hasAnalyticsConsent, () => false);
  return (
    <label className="flex items-start gap-3 rounded-[4px] border border-line/[0.08] bg-panel p-4">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => setAnalyticsConsent(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-emerald"
      />
      <span>
        <span className="block text-[13px] font-medium text-ink">
          Share anonymous usage and ad measurement
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">
          Page visits, the ad campaign that brought you here, and claim and transaction steps,
          measured with PostHog and the Meta Pixel. Wallet addresses, emails, gift codes,
          signatures, certificates, private forms and delivery details are never sent.
        </span>
      </span>
    </label>
  );
}

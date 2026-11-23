import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/Button';
import { analyticsConfigured, analyticsConsentDecided, setAnalyticsConsent } from '@/lib/telemetry';

function subscribe(callback: () => void) {
  window.addEventListener('dc:analytics-consent', callback);
  return () => window.removeEventListener('dc:analytics-consent', callback);
}

/**
 * Asks once whether visits may be measured. Nothing is sent to PostHog or Meta
 * until the visitor accepts; declining is remembered the same way. The choice
 * can be changed later under Profile.
 */
export function ConsentBanner() {
  const decided = useSyncExternalStore(subscribe, analyticsConsentDecided, () => true);
  if (decided || !analyticsConfigured()) return null;

  return (
    <div
      role="region"
      aria-label="Analytics consent"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-[560px] animate-dcslideup rounded-[4px] border border-line/[0.12] bg-elevated p-4 shadow-[0_24px_80px_rgba(0,0,0,.45)] sm:bottom-5"
    >
      <p className="text-[13px] font-medium text-ink">Help us improve Digital Carat</p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
        May we measure visits and which ads brought you here? We use PostHog and the Meta Pixel.
        Wallet addresses, emails and gift codes are never sent.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setAnalyticsConsent(true)}>
          Accept
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setAnalyticsConsent(false)}>
          Decline
        </Button>
      </div>
    </div>
  );
}
